// app/(admin)/attendance/kiosk.tsx
// Admin-session kiosk — opened from dashboard while admin is logged in.
// isDedicatedMode = false: no pairing, no AsyncStorage, X button to exit back.
// Camera + face detection only. No history panel. Exits after each punch OR on X press.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions, StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FaceDetector from '@react-native-ml-kit/face-detection';
import NetInfo from '@react-native-community/netinfo';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { Worker, OrgSettings } from '../../../src/types/index';
import {
  OfflinePunch, buildAndWritePunch, saveToOfflineQueue,
  retryOfflineQueue, determinePunchType,
} from '../../../src/services/kioskPunchService';

const { width: W, height: H } = Dimensions.get('window');
const OVAL_SIZE = W * 0.58;
const LIVENESS_OPEN  = 0.7;
const LIVENESS_CLOSE = 0.2;
const LIVENESS_TIMEOUT = 4000;
const RECOGNITION_THRESHOLD = 0.40;
const COOLDOWN_MS = 4000;
const FPS_MS = 120;
const SUCCESS_MS = 3000;

type Phase = 'IDLE' | 'FACE_FOUND' | 'RECOGNIZING' | 'SUCCESS' | 'ERROR' | 'OFFLINE';

interface Descriptor { workerId: string; workerName: string; descriptor: number[]; }

function cosineDist(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 1;
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i]; }
  const d = Math.sqrt(mA) * Math.sqrt(mB);
  return d === 0 ? 1 : 1 - dot / d;
}

export default function AdminKioskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ branchId?: string }>();
  const { profile } = useAuth();

  const branchId = (params.branchId as string) ?? 'default';
  const tenantId  = profile?.tenantId ?? '';

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [descriptors, setDescriptors] = useState<Descriptor[]>([]);
  const [descriptorsLoaded, setDescriptorsLoaded] = useState(false);
  const settingsRef = useRef<OrgSettings>({ shifts: [], enableBreakTracking: false });
  const workersRef  = useRef<Worker[]>([]);

  const [phase, setPhase]       = useState<Phase>('IDLE');
  const [statusMsg, setStatusMsg] = useState('Stand in front of camera');
  const [faceInFrame, setFaceInFrame] = useState(false);
  const [successData, setSuccessData] = useState<{ name: string; type: 'IN'|'OUT'; time: string } | null>(null);

  const livenessRef   = useRef({ seenOpen: false, startMs: 0 });
  const processingRef = useRef(false);
  const lastPunchRef  = useRef(0);
  const frameTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  const [clock, setClock] = useState('');

  // ── Hide status bar ──────────────────────────────────────────────────────
  useEffect(() => {
    StatusBar.setHidden(true, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, []);

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Load workers for this branch ─────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const [workers, settings] = await Promise.all([
          dbService.getWorkers(tenantId),
          dbService.getOrgSettings(tenantId),
        ]);
        settingsRef.current = settings;
        workersRef.current  = workers;

        const filtered = workers.filter(
          (w) => (!branchId || branchId === 'default' || w.branchId === branchId)
            && w.status === 'ACTIVE'
            && (w as any).faceDescriptor?.length > 0
        );
        setDescriptors(filtered.map((w) => ({
          workerId: w.id, workerName: w.name,
          descriptor: (w as any).faceDescriptor as number[],
        })));
      } catch (e) { console.error('Worker load:', e); }
      finally { setDescriptorsLoaded(true); }
    })();
  }, [tenantId, branchId]);

  // ── Retry offline queue ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener(async (s) => {
      if (s.isConnected) await retryOfflineQueue(settingsRef.current, workersRef.current);
    });
    return () => unsub();
  }, []);

  // ── Frame loop ────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    if (frameTimer.current) return;
    frameTimer.current = setInterval(async () => {
      if (processingRef.current || !cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, base64: false, skipProcessing: true });
        if (photo?.uri) await detectFace(photo.uri);
      } catch { /* silent */ }
    }, FPS_MS);
  }, []);

  const stopLoop = useCallback(() => {
    if (frameTimer.current) { clearInterval(frameTimer.current); frameTimer.current = null; }
  }, []);

  useEffect(() => {
    if (permission?.granted && descriptorsLoaded) startLoop();
    return () => stopLoop();
  }, [permission, descriptorsLoaded]);

  // ── Face detection ────────────────────────────────────────────────────────
  const detectFace = async (uri: string) => {
    if (processingRef.current || Date.now() - lastPunchRef.current < COOLDOWN_MS) return;
    let faces: any[] = [];
    try { faces = await FaceDetector.detect(uri, { performanceMode: 'fast', landmarkMode: 'all', classificationMode: 'all' }); }
    catch { return; }

    if (!faces.length) {
      if (faceInFrame) { setFaceInFrame(false); setPhase('IDLE'); setStatusMsg('Stand in front of camera'); livenessRef.current = { seenOpen: false, startMs: 0 }; }
      return;
    }

    const face = faces[0];
    const lo = face.leftEyeOpenProbability ?? 0;
    const ro = face.rightEyeOpenProbability ?? 0;

    if (!faceInFrame) {
      setFaceInFrame(true); setPhase('FACE_FOUND'); setStatusMsg('Hold still…');
      livenessRef.current = { seenOpen: false, startMs: Date.now() };
    }

    const { seenOpen, startMs } = livenessRef.current;
    if (!seenOpen) {
      if (lo > LIVENESS_OPEN && ro > LIVENESS_OPEN) livenessRef.current.seenOpen = true;
    } else {
      if (lo < LIVENESS_CLOSE && ro < LIVENESS_CLOSE) { await runRecognition(uri); return; }
    }

    if (Date.now() - startMs > LIVENESS_TIMEOUT) {
      setPhase('ERROR'); setStatusMsg('Please blink naturally');
      livenessRef.current = { seenOpen: false, startMs: Date.now() };
      setTimeout(() => { setPhase('IDLE'); setStatusMsg('Stand in front of camera'); setFaceInFrame(false); }, 2500);
    }
  };

  // ── Recognition ──────────────────────────────────────────────────────────
  const runRecognition = async (uri: string) => {
    processingRef.current = true; setPhase('RECOGNIZING'); setStatusMsg('Identifying…');
    try {
      const faces = await FaceDetector.detect(uri, { performanceMode: 'accurate', landmarkMode: 'all', classificationMode: 'all' });
      if (!faces.length) throw new Error('no face');
      const live = buildDescriptor(faces[0]);
      let best = Infinity, match: Descriptor | null = null;
      for (const d of descriptors) {
        if (d.descriptor.length !== live.length) continue;
        const dist = cosineDist(live, d.descriptor);
        if (dist < best) { best = dist; match = d; }
      }
      if (!match || best > RECOGNITION_THRESHOLD) {
        setPhase('ERROR'); setStatusMsg('Face not recognized. Try again.');
        setTimeout(() => { setPhase('IDLE'); setStatusMsg('Stand in front of camera'); setFaceInFrame(false); processingRef.current = false; livenessRef.current = { seenOpen: false, startMs: 0 }; }, 3000);
        return;
      }
      await recordPunch(match.workerId, match.workerName);
    } catch {
      setPhase('ERROR'); setStatusMsg('Error. Please try again.');
      setTimeout(() => { setPhase('IDLE'); setStatusMsg('Stand in front of camera'); setFaceInFrame(false); processingRef.current = false; livenessRef.current = { seenOpen: false, startMs: 0 }; }, 3000);
    }
  };

  const buildDescriptor = (face: any): number[] => {
    const box = face.frame ?? face.boundingBox ?? { width: 1, height: 1, left: 0, top: 0 };
    const W2 = box.width || 1, H2 = box.height || 1, L = box.left || 0, T = box.top || 0;
    const n = (pt: any) => pt ? [(pt.x - L) / W2, (pt.y - T) / H2] : [0, 0];
    const lm = face.landmarks ?? {};
    return [...n(lm.LEFT_EYE), ...n(lm.RIGHT_EYE), ...n(lm.NOSE_BASE), ...n(lm.MOUTH_LEFT), ...n(lm.MOUTH_RIGHT), ...n(lm.LEFT_EAR), ...n(lm.RIGHT_EAR), ...n(lm.LEFT_CHEEK), ...n(lm.RIGHT_CHEEK), face.leftEyeOpenProbability ?? 0, face.rightEyeOpenProbability ?? 0, face.smilingProbability ?? 0, (face.headEulerAngleY ?? 0) / 180, (face.headEulerAngleZ ?? 0) / 180];
  };

  // ── Record punch ──────────────────────────────────────────────────────────
  const recordPunch = async (workerId: string, workerName: string) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const punchType = await determinePunchType(tenantId, workerId, today);

    const punch: OfflinePunch = {
      id: `${tenantId}_${workerId}_${now.getTime()}`,
      tenantId, workerId, workerName,
      branchId, terminalId: 'admin-session',
      punchType, timestamp: now.toISOString(),
      isLivenessPassed: true, method: 'Face Scan',
    };

    const net = await NetInfo.fetch();
    let offline = false;
    if (net.isConnected) {
      try {
        const wo = workersRef.current.find((w) => w.id === workerId) ?? ({ id: workerId, name: workerName, shiftId: 'default' } as unknown as Worker);
        await buildAndWritePunch(punch, settingsRef.current, wo);
      } catch { await saveToOfflineQueue(punch); offline = true; }
    } else { await saveToOfflineQueue(punch); offline = true; }

    lastPunchRef.current = Date.now();
    setPhase(offline ? 'OFFLINE' : 'SUCCESS');
    setSuccessData({ name: workerName, type: punchType, time: timeStr });
    setStatusMsg(`${punchType === 'IN' ? 'Welcome' : 'Goodbye'}, ${workerName}!`);

    setTimeout(() => {
      setPhase('IDLE'); setStatusMsg('Stand in front of camera');
      setFaceInFrame(false); setSuccessData(null);
      processingRef.current = false; livenessRef.current = { seenOpen: false, startMs: 0 };
      // In admin-session mode: stay open (do NOT exit — mirrors original isDedicatedMode=false behaviour
      // where after punch it stays ready for next person)
    }, SUCCESS_MS);
  };

  // ── Exit ──────────────────────────────────────────────────────────────────
  const handleExit = () => {
    stopLoop();
    router.back();
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!permission) {
    return <View style={s.center}><Text style={s.txt}>Checking camera…</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={s.center}>
        <Ionicons name="camera-outline" size={48} color="#6B7280" />
        <Text style={s.txt}>Camera permission required.</Text>
        <Pressable style={s.btn} onPress={requestPermission}><Text style={s.btnTxt}>Grant Permission</Text></Pressable>
      </View>
    );
  }

  const ovalColor =
    phase === 'SUCCESS' || phase === 'OFFLINE' ? '#22C55E'
    : phase === 'ERROR'                        ? '#EF4444'
    : phase === 'FACE_FOUND' || phase === 'RECOGNIZING' ? '#FACC15'
    : 'rgba(255,255,255,0.35)';

  const statusBg =
    phase === 'SUCCESS' || phase === 'OFFLINE' ? 'rgba(21,128,61,0.88)'
    : phase === 'ERROR'                        ? 'rgba(185,28,28,0.88)'
    : phase === 'RECOGNIZING'                  ? 'rgba(37,99,235,0.88)'
    : 'rgba(0,0,0,0.55)';

  return (
    <View style={s.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
      <View style={s.vignette} pointerEvents="none" />

      {/* Top bar — clock + X close button (visible because admin is present) */}
      <View style={s.topBar}>
        <View style={s.clockPill}>
          <Text style={s.clockTxt}>{clock}</Text>
        </View>
        {/* X button — mirrors original's non-dedicated close button */}
        <Pressable style={s.closeBtn} onPress={handleExit}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Loading badge */}
      {!descriptorsLoaded && (
        <View style={s.loadBadge} pointerEvents="none">
          <Text style={s.loadBadgeTxt}>Loading faces…</Text>
        </View>
      )}

      {/* Oval face guide */}
      <View style={s.ovalWrap} pointerEvents="none">
        <View style={[s.oval, { width: OVAL_SIZE, height: OVAL_SIZE * 1.2, borderRadius: OVAL_SIZE / 2, borderColor: ovalColor }]}>
          {phase === 'RECOGNIZING' && <View style={s.scanLine} />}
        </View>
        {/* Hint text inside oval area */}
        <Text style={s.ovalHint}>
          {phase === 'FACE_FOUND' ? '👁  Blink to verify' : 'Place face in circle'}
        </Text>
      </View>

      {/* Status pill */}
      <View style={s.statusWrap} pointerEvents="none">
        <View style={[s.statusBox, { backgroundColor: statusBg }]}>
          {phase === 'RECOGNIZING' && <Ionicons name="scan-outline" size={14} color="#fff" style={{ marginRight: 6 }} />}
          {(phase === 'SUCCESS' || phase === 'OFFLINE') && <Ionicons name="checkmark-circle" size={16} color="#fff" style={{ marginRight: 6 }} />}
          {phase === 'ERROR' && <Ionicons name="alert-circle" size={16} color="#fff" style={{ marginRight: 6 }} />}
          <Text style={s.statusTxt}>{statusMsg}</Text>
        </View>
        {phase === 'OFFLINE' && (
          <View style={s.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color="#FBBF24" />
            <Text style={s.offlineTxt}>Offline — saved locally</Text>
          </View>
        )}
      </View>

      {/* Enrolled count */}
      {descriptorsLoaded && (
        <View style={s.enrollBadge} pointerEvents="none">
          <Ionicons name="people-outline" size={11} color="rgba(255,255,255,0.7)" />
          <Text style={s.enrollTxt}>{descriptors.length} enrolled</Text>
        </View>
      )}

      {/* Success overlay */}
      {successData && (phase === 'SUCCESS' || phase === 'OFFLINE') && (
        <View style={s.successOverlay}>
          <View style={s.successCard}>
            <View style={[s.successAvatar, { backgroundColor: successData.type === 'IN' ? '#22C55E' : '#EF4444' }]}>
              <Text style={s.successAvatarTxt}>{successData.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={s.successName}>{successData.name}</Text>
            <View style={[s.successBadge, { backgroundColor: successData.type === 'IN' ? '#DCFCE7' : '#FEE2E2' }]}>
              <Ionicons name={successData.type === 'IN' ? 'log-in-outline' : 'log-out-outline'} size={14} color={successData.type === 'IN' ? '#15803D' : '#DC2626'} />
              <Text style={[s.successBadgeTxt, { color: successData.type === 'IN' ? '#15803D' : '#DC2626' }]}>
                {successData.type === 'IN' ? 'Checked IN' : 'Checked OUT'}
              </Text>
            </View>
            <Text style={s.successTime}>{successData.time}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  center:  { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  txt:     { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  btn:     { backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  btnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },

  topBar:  { position: 'absolute', top: 48, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, zIndex: 10 },
  clockPill: { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  clockTxt: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  closeBtn:  { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, padding: 8 },

  loadBadge: { position: 'absolute', top: 48, left: 0, right: 0, alignItems: 'center', zIndex: 9 },
  loadBadgeTxt: { color: '#FBBF24', fontSize: 11, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },

  ovalWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  oval:     { borderWidth: 3, overflow: 'hidden' },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(250,204,21,0.7)', top: '50%' },
  ovalHint: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', marginTop: 16, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },

  statusWrap: { position: 'absolute', bottom: '14%', left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 10 },
  statusBox:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24 },
  statusTxt:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  offlinePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' },
  offlineTxt:  { color: '#FBBF24', fontSize: 10, fontWeight: '600' },

  enrollBadge: { position: 'absolute', bottom: 16, right: 14, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  enrollTxt:   { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },

  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  successCard:    { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 24, padding: 28, alignItems: 'center', gap: 8, width: '78%', maxWidth: 300 },
  successAvatar:  { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  successAvatarTxt: { color: '#fff', fontSize: 26, fontWeight: '900' },
  successName:    { fontSize: 18, fontWeight: '900', color: '#111827' },
  successBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  successBadgeTxt:{ fontSize: 12, fontWeight: '800' },
  successTime:    { fontSize: 13, color: '#6B7280', fontWeight: '600' },
});
