// src/screens/KioskScreen.tsx
// Dedicated terminal mode — mirrors original AttendanceKioskScreen with isDedicatedMode=true
// Layout: Camera (left/top 2/3) + Live Activity history panel (right/bottom 1/3)
// Exit: Hidden lock button → 4-digit Admin PIN → clears AsyncStorage → goes to login

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal,
  Dimensions, StatusBar, ScrollView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FaceDetector from '@react-native-ml-kit/face-detection';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { dbService } from '../services/db';
import { Worker, OrgSettings } from '../types/index';
import {
  KioskConfig, OfflinePunch,
  KIOSK_CONFIG_KEY,
  buildAndWritePunch, saveToOfflineQueue, retryOfflineQueue,
  determinePunchType,
} from '../services/kioskPunchService';

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get('window');
const IS_LANDSCAPE     = W > H;
// In landscape (tablet): camera takes 65% width, history takes 35%
// In portrait (phone):   camera takes 60% height, history takes 40%
const OVAL_SIZE        = IS_LANDSCAPE ? H * 0.55 : W * 0.55;

const LIVENESS_OPEN  = 0.7;
const LIVENESS_CLOSE = 0.2;
const LIVENESS_TIMEOUT = 4000;
const RECOGNITION_THRESHOLD = 0.40;
const COOLDOWN_MS    = 4000;
const FPS_MS         = 120;
const SUCCESS_MS     = 3500;

type Phase = 'IDLE' | 'FACE_FOUND' | 'RECOGNIZING' | 'SUCCESS' | 'ERROR' | 'OFFLINE';

interface Descriptor {
  workerId: string;
  workerName: string;
  descriptor: number[];
}

interface PunchLog {
  name: string;
  type: 'IN' | 'OUT';
  time: string;
  offline: boolean;
}

// ─── Cosine distance ──────────────────────────────────────────────────────────
function cosineDist(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 1;
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i]; }
  const d = Math.sqrt(mA) * Math.sqrt(mB);
  return d === 0 ? 1 : 1 - dot / d;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function KioskScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // Config
  const [kioskConfig, setKioskConfig] = useState<KioskConfig | null>(null);
  const [configLoading, setConfigLoading]  = useState(true);

  // Descriptors
  const [descriptors, setDescriptors] = useState<Descriptor[]>([]);
  const [descriptorsLoaded, setDescriptorsLoaded] = useState(false);
  const settingsRef = useRef<OrgSettings>({ shifts: [], enableBreakTracking: false });
  const workersRef  = useRef<Worker[]>([]);

  // Detection state
  const [phase, setPhase]         = useState<Phase>('IDLE');
  const [statusMsg, setStatusMsg] = useState('Stand in front of camera');
  const [faceInFrame, setFaceInFrame] = useState(false);
  const [successData, setSuccessData] = useState<{ name: string; type: 'IN'|'OUT'; time: string } | null>(null);

  const livenessRef   = useRef({ seenOpen: false, startMs: 0 });
  const processingRef = useRef(false);
  const lastPunchRef  = useRef(0);
  const frameTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live activity log (mirrors original's recentPunches)
  const [punchLog, setPunchLog] = useState<PunchLog[]>([]);

  // Clock
  const [clock, setClock] = useState('');

  // PIN exit
  const [pinModal, setPinModal] = useState(false);
  const [pin, setPin]           = useState('');
  const [pinError, setPinError] = useState('');

  // ── Hide status bar in kiosk mode ─────────────────────────────────────────
  useEffect(() => {
    StatusBar.setHidden(true, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Load kiosk config ─────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(KIOSK_CONFIG_KEY)
      .then((raw) => { if (raw) setKioskConfig(JSON.parse(raw)); })
      .catch(console.error)
      .finally(() => setConfigLoading(false));
  }, []);

  // ── Load workers + descriptors ────────────────────────────────────────────
  useEffect(() => {
    if (!kioskConfig) return;
    (async () => {
      try {
        const [workers, settings] = await Promise.all([
          dbService.getWorkers(kioskConfig.tenantId),
          dbService.getOrgSettings(kioskConfig.tenantId),
        ]);
        settingsRef.current = settings;
        workersRef.current  = workers;

        const branch = workers.filter(
          (w) => (!kioskConfig.branchId || w.branchId === kioskConfig.branchId)
            && w.status === 'ACTIVE'
            && (w as any).faceDescriptor?.length > 0
        );

        setDescriptors(branch.map((w) => ({
          workerId:   w.id,
          workerName: w.name,
          descriptor: (w as any).faceDescriptor as number[],
        })));
        setDescriptorsLoaded(true);
      } catch (e) {
        console.error('Descriptor load:', e);
        setDescriptorsLoaded(true);
      }
    })();
  }, [kioskConfig]);

  // ── Retry offline queue on reconnect ─────────────────────────────────────
  useEffect(() => {
    if (!kioskConfig) return;
    const unsub = NetInfo.addEventListener(async (s) => {
      if (s.isConnected) await retryOfflineQueue(settingsRef.current, workersRef.current);
    });
    return () => unsub();
  }, [kioskConfig]);

  // ── Frame loop ─────────────────────────────────────────────────────────────
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
    if (permission?.granted && descriptorsLoaded && kioskConfig) startLoop();
    return () => stopLoop();
  }, [permission, descriptorsLoaded, kioskConfig]);

  // ── Face detection ────────────────────────────────────────────────────────
  const detectFace = async (uri: string) => {
    if (processingRef.current || Date.now() - lastPunchRef.current < COOLDOWN_MS) return;
    let faces: any[] = [];
    try {
      faces = await FaceDetector.detect(uri, { performanceMode: 'fast', landmarkMode: 'all', classificationMode: 'all' });
    } catch { return; }

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

  // ── Recognition ───────────────────────────────────────────────────────────
  const runRecognition = async (uri: string) => {
    processingRef.current = true;
    setPhase('RECOGNIZING'); setStatusMsg('Identifying…');
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
    const W = box.width || 1, H = box.height || 1, L = box.left || 0, T = box.top || 0;
    const n = (pt: any) => pt ? [(pt.x - L) / W, (pt.y - T) / H] : [0, 0];
    const lm = face.landmarks ?? {};
    return [...n(lm.LEFT_EYE), ...n(lm.RIGHT_EYE), ...n(lm.NOSE_BASE), ...n(lm.MOUTH_LEFT), ...n(lm.MOUTH_RIGHT), ...n(lm.LEFT_EAR), ...n(lm.RIGHT_EAR), ...n(lm.LEFT_CHEEK), ...n(lm.RIGHT_CHEEK), face.leftEyeOpenProbability ?? 0, face.rightEyeOpenProbability ?? 0, face.smilingProbability ?? 0, (face.headEulerAngleY ?? 0) / 180, (face.headEulerAngleZ ?? 0) / 180];
  };

  // ── Record punch ──────────────────────────────────────────────────────────
  const recordPunch = async (workerId: string, workerName: string) => {
    if (!kioskConfig) return;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const punchType = await determinePunchType(kioskConfig.tenantId, workerId, today);

    const punch: OfflinePunch = {
      id: `${kioskConfig.tenantId}_${workerId}_${now.getTime()}`,
      tenantId: kioskConfig.tenantId,
      workerId, workerName,
      branchId: kioskConfig.branchId,
      terminalId: kioskConfig.terminalId,
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
    } else {
      await saveToOfflineQueue(punch); offline = true;
    }

    lastPunchRef.current = Date.now();
    setPhase(offline ? 'OFFLINE' : 'SUCCESS');
    setSuccessData({ name: workerName, type: punchType, time: timeStr });
    setStatusMsg(`${punchType === 'IN' ? 'Welcome' : 'Goodbye'}, ${workerName}!`);

    // Append to live activity log (mirrors original recentPunches)
    setPunchLog((prev) => [{ name: workerName, type: punchType, time: timeStr, offline }, ...prev].slice(0, 20));

    setTimeout(() => {
      setPhase('IDLE'); setStatusMsg('Stand in front of camera');
      setFaceInFrame(false); setSuccessData(null);
      processingRef.current = false; livenessRef.current = { seenOpen: false, startMs: 0 };
    }, SUCCESS_MS);
  };

  // ── PIN exit ──────────────────────────────────────────────────────────────
  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) validatePin(next);
  };

  const validatePin = async (entered: string) => {
    if (!kioskConfig) return;
    if (entered === kioskConfig.adminPin) {
      stopLoop();
      await AsyncStorage.removeItem(KIOSK_CONFIG_KEY);
      // No admin session on this tablet — go to login
      router.replace('/(auth)/login' as any);
    } else {
      setPinError('Incorrect PIN. Try again.');
      setPin('');
    }
  };

  // ─── Guards ───────────────────────────────────────────────────────────────
  if (configLoading) {
    return (
      <View style={s.center}>
        <Ionicons name="tv-outline" size={48} color="#4F46E5" />
        <Text style={s.loadTxt}>Initialising Terminal…</Text>
      </View>
    );
  }

  if (!kioskConfig) {
    return (
      <View style={s.center}>
        <Ionicons name="qr-code-outline" size={48} color="#6B7280" />
        <Text style={s.loadTxt}>Terminal not paired.</Text>
        <Text style={s.loadSub}>Ask your Admin to generate a pairing code from{'\n'}Settings → Terminals, then scan it from the Login screen.</Text>
        <Pressable style={s.actionBtn} onPress={() => router.replace('/(auth)/login' as any)}>
          <Text style={s.actionBtnTxt}>Go to Login</Text>
        </Pressable>
      </View>
    );
  }

  if (!permission) {
    return <View style={s.center}><Text style={s.loadTxt}>Checking camera…</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={s.center}>
        <Ionicons name="camera-outline" size={48} color="#6B7280" />
        <Text style={s.loadTxt}>Camera permission required.</Text>
        <Pressable style={s.actionBtn} onPress={requestPermission}>
          <Text style={s.actionBtnTxt}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Colours ───────────────────────────────────────────────────────────────
  const ovalColor =
    phase === 'SUCCESS' || phase === 'OFFLINE'  ? '#22C55E'
    : phase === 'ERROR'                         ? '#EF4444'
    : phase === 'FACE_FOUND' || phase === 'RECOGNIZING' ? '#FACC15'
    : 'rgba(255,255,255,0.35)';

  const statusBg =
    phase === 'SUCCESS' || phase === 'OFFLINE' ? 'rgba(21,128,61,0.88)'
    : phase === 'ERROR'                        ? 'rgba(185,28,28,0.88)'
    : phase === 'RECOGNIZING'                  ? 'rgba(37,99,235,0.88)'
    : 'rgba(0,0,0,0.55)';

  // ─── Render ───────────────────────────────────────────────────────────────
  // Layout mirrors original: landscape = row (camera | history), portrait = column (camera | history)
  return (
    <View style={[s.root, IS_LANDSCAPE ? s.row : s.col]}>

      {/* ── LEFT / TOP: Camera panel ─────────────────────────────────────── */}
      <View style={IS_LANDSCAPE ? s.camPanelLandscape : s.camPanelPortrait}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />

        {/* Vignette overlay */}
        <View style={s.vignette} pointerEvents="none" />

        {/* Top bar — org name + clock */}
        <View style={s.topBar}>
          <View>
            <Text style={s.orgName}>{kioskConfig.orgName}</Text>
            <Text style={s.branchName}>{kioskConfig.branchName} · {kioskConfig.terminalName}</Text>
          </View>
          <View style={s.topRight}>
            <Text style={s.clock}>{clock}</Text>
            {!descriptorsLoaded && (
              <View style={s.loadPill}><Text style={s.loadPillTxt}>Loading faces…</Text></View>
            )}
          </View>
        </View>

        {/* Oval face guide */}
        <View style={s.ovalWrap} pointerEvents="none">
          <View style={[s.oval, { width: OVAL_SIZE, height: OVAL_SIZE * 1.2, borderRadius: OVAL_SIZE / 2, borderColor: ovalColor }]}>
            {phase === 'RECOGNIZING' && <View style={s.scanLine} />}
          </View>
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

        {/* Liveness hint */}
        {phase === 'FACE_FOUND' && (
          <View style={s.livenessHint} pointerEvents="none">
            <Text style={s.livenessHintTxt}>👁  Blink to verify</Text>
          </View>
        )}

        {/* Success overlay card (mirrors original's detectedWorker modal) */}
        {successData && (phase === 'SUCCESS' || phase === 'OFFLINE') && (
          <View style={s.successOverlay}>
            <View style={s.successCard}>
              <View style={[s.successAvatar, { backgroundColor: successData.type === 'IN' ? '#22C55E' : '#EF4444' }]}>
                <Text style={s.successAvatarTxt}>{successData.name.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={s.successName}>{successData.name}</Text>
              <View style={[s.successBadge, { backgroundColor: successData.type === 'IN' ? '#DCFCE7' : '#FEE2E2' }]}>
                <Ionicons
                  name={successData.type === 'IN' ? 'log-in-outline' : 'log-out-outline'}
                  size={14}
                  color={successData.type === 'IN' ? '#15803D' : '#DC2626'}
                />
                <Text style={[s.successBadgeTxt, { color: successData.type === 'IN' ? '#15803D' : '#DC2626' }]}>
                  {successData.type === 'IN' ? 'Checked IN' : 'Checked OUT'}
                </Text>
              </View>
              <Text style={s.successTime}>{successData.time}</Text>
            </View>
          </View>
        )}

        {/* Enrolled count badge */}
        {descriptorsLoaded && (
          <View style={s.enrollBadge} pointerEvents="none">
            <Ionicons name="people-outline" size={11} color="rgba(255,255,255,0.7)" />
            <Text style={s.enrollTxt}>{descriptors.length} enrolled</Text>
          </View>
        )}

        {/* Hidden exit button — tiny, bottom-left, low opacity (mirrors original's Lock button) */}
        <Pressable style={s.exitBtn} onPress={() => { stopLoop(); setPinModal(true); setPin(''); setPinError(''); }}>
          <Ionicons name="lock-closed-outline" size={14} color="rgba(255,255,255,0.35)" />
        </Pressable>
      </View>

      {/* ── RIGHT / BOTTOM: Live Activity panel ──────────────────────────── */}
      {/* Mirrors original's isDedicatedMode side panel */}
      <View style={IS_LANDSCAPE ? s.historyPanelLandscape : s.historyPanelPortrait}>
        {/* Panel header */}
        <View style={s.historyHeader}>
          <Text style={s.historyTitle}>Live Activity</Text>
          <View style={s.activeDot}>
            <View style={s.activePulse} />
            <Text style={s.activeText}>Monitoring</Text>
          </View>
        </View>

        {/* Punch log list */}
        <ScrollView
          style={s.historyScroll}
          contentContainerStyle={s.historyContent}
          showsVerticalScrollIndicator={false}
        >
          {punchLog.length === 0 ? (
            <View style={s.emptyLog}>
              <Ionicons name="time-outline" size={40} color="#374151" />
              <Text style={s.emptyLogTxt}>Awaiting first scan…</Text>
            </View>
          ) : (
            punchLog.map((p, i) => (
              <View key={i} style={s.logRow}>
                <View style={[s.logIcon, { backgroundColor: p.type === 'IN' ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.15)' }]}>
                  <Ionicons
                    name={p.type === 'IN' ? 'log-in-outline' : 'log-out-outline'}
                    size={18}
                    color={p.type === 'IN' ? '#22C55E' : '#F97316'}
                  />
                </View>
                <View style={s.logInfo}>
                  <Text style={s.logName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.logMeta}>
                    Punched {p.type} · {p.time}
                    {p.offline ? '  ⚡ offline' : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* ── PIN exit modal ────────────────────────────────────────────────── */}
      <Modal visible={pinModal} transparent animationType="fade" onRequestClose={() => { setPinModal(false); startLoop(); }}>
        <View style={s.pinOverlay}>
          <View style={s.pinCard}>
            <Ionicons name="shield-checkmark-outline" size={32} color="#EF4444" style={{ marginBottom: 8 }} />
            <Text style={s.pinTitle}>Exit Kiosk Mode</Text>
            <Text style={s.pinSub}>Enter Admin PIN to close terminal</Text>
            <View style={s.pinDots}>
              {[0,1,2,3].map((i) => (
                <View key={i} style={[s.pinDot, pin.length > i && s.pinDotFilled]} />
              ))}
            </View>
            {!!pinError && <Text style={s.pinError}>{pinError}</Text>}
            <View style={s.numpad}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, idx) => (
                <Pressable
                  key={idx}
                  style={[s.numKey, d === '' && s.numKeyEmpty]}
                  onPress={() => {
                    if (!d) return;
                    if (d === '⌫') { setPin((p) => p.slice(0, -1)); setPinError(''); }
                    else handleDigit(d);
                  }}
                  disabled={!d}
                >
                  <Text style={s.numKeyTxt}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.pinCancel} onPress={() => { setPinModal(false); startLoop(); }}>
              <Text style={s.pinCancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  row:     { flexDirection: 'row' },
  col:     { flexDirection: 'column' },

  // Camera panel
  camPanelLandscape: { flex: 0.65, position: 'relative', overflow: 'hidden' },
  camPanelPortrait:  { flex: 0.60, position: 'relative', overflow: 'hidden' },

  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },

  topBar:    { position: 'absolute', top: 44, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, zIndex: 10 },
  orgName:   { color: '#fff', fontSize: 16, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  branchName:{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
  topRight:  { alignItems: 'flex-end', gap: 5 },
  clock:     { color: '#fff', fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  loadPill:  { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  loadPillTxt:{ color: '#FBBF24', fontSize: 10, fontWeight: '700' },

  ovalWrap:  { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  oval:      { borderWidth: 3, overflow: 'hidden', position: 'relative' },
  scanLine:  { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(250,204,21,0.7)', top: '50%' },

  statusWrap: { position: 'absolute', bottom: '18%', left: 0, right: 0, alignItems: 'center', gap: 8, zIndex: 10 },
  statusBox:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 24 },
  statusTxt:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  offlinePill:{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' },
  offlineTxt: { color: '#FBBF24', fontSize: 10, fontWeight: '600' },

  livenessHint:    { position: 'absolute', bottom: '30%', left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  livenessHintTxt: { color: '#fff', fontSize: 12, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },

  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.78)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  successCard:    { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 24, padding: 24, alignItems: 'center', gap: 8, width: '80%', maxWidth: 300 },
  successAvatar:   { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  successAvatarTxt:{ color: '#fff', fontSize: 26, fontWeight: '900' },
  successName:     { fontSize: 18, fontWeight: '900', color: '#111827' },
  successBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  successBadgeTxt: { fontSize: 12, fontWeight: '800' },
  successTime:     { fontSize: 13, color: '#6B7280', fontWeight: '600' },

  enrollBadge: { position: 'absolute', bottom: 16, right: 14, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  enrollTxt:   { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },

  // Hidden exit — very subtle, bottom-left
  exitBtn: { position: 'absolute', bottom: 16, left: 14, padding: 10, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 20 },

  // History panel — mirrors original's isDedicatedMode side panel
  historyPanelLandscape: { flex: 0.35, backgroundColor: '#030712', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)' },
  historyPanelPortrait:  { flex: 0.40, backgroundColor: '#030712', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },

  historyHeader: { padding: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', backgroundColor: '#000' },
  historyTitle:  { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  activeDot:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  activePulse:   { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22C55E' },
  activeText:    { color: '#6B7280', fontSize: 11, fontWeight: '600' },

  historyScroll:  { flex: 1 },
  historyContent: { padding: 12, gap: 8 },

  emptyLog:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 10 },
  emptyLogTxt: { color: '#374151', fontSize: 13, fontWeight: '600' },

  logRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111827', borderRadius: 14, padding: 12, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  logIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logInfo: { flex: 1 },
  logName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  logMeta: { color: '#6B7280', fontSize: 10, marginTop: 2, fontWeight: '500' },

  // PIN modal
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  pinCard:    { backgroundColor: '#1F2937', borderRadius: 24, padding: 28, width: 300, alignItems: 'center', gap: 8 },
  pinTitle:   { color: '#fff', fontSize: 17, fontWeight: '900' },
  pinSub:     { color: '#9CA3AF', fontSize: 12, textAlign: 'center' },
  pinDots:    { flexDirection: 'row', gap: 14, marginVertical: 8 },
  pinDot:     { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#EF4444', backgroundColor: 'transparent' },
  pinDotFilled:{ backgroundColor: '#EF4444' },
  pinError:   { color: '#EF4444', fontSize: 12, fontWeight: '600' },
  numpad:     { flexDirection: 'row', flexWrap: 'wrap', width: 228, gap: 9, marginTop: 6, justifyContent: 'center' },
  numKey:     { width: 66, height: 54, borderRadius: 13, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  numKeyEmpty:{ backgroundColor: 'transparent', elevation: 0 },
  numKeyTxt:  { color: '#fff', fontSize: 20, fontWeight: '800' },
  pinCancel:  { marginTop: 6, paddingVertical: 10, paddingHorizontal: 24 },
  pinCancelTxt:{ color: '#9CA3AF', fontSize: 13, fontWeight: '600' },

  // Non-kiosk states
  center:    { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  loadTxt:   { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  loadSub:   { color: '#9CA3AF', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  actionBtn: { backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  actionBtnTxt:{ color: '#fff', fontWeight: '700', fontSize: 14 },
});
