// app/(admin)/attendance/kiosk.native.tsx
import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FaceDetector from '@react-native-ml-kit/face-detection';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { Worker, OrgSettings } from '../../../src/types/index';
import {
  KioskConfig, OfflinePunch,
  KIOSK_CONFIG_KEY,
  buildAndWritePunch, saveToOfflineQueue, retryOfflineQueue,
  determinePunchType,
} from '../../../src/services/kioskPunchService';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const OVAL_W                  = SCREEN_W * 0.55;
const OVAL_H                  = OVAL_W * 1.3;
const LIVENESS_OPEN_THRESHOLD  = 0.7;
const LIVENESS_CLOSE_THRESHOLD = 0.2;
const LIVENESS_TIMEOUT_MS      = 4000;
const RECOGNITION_THRESHOLD    = 0.40;
const COOLDOWN_MS              = 4000;
const FPS_INTERVAL_MS          = 100;
const SUCCESS_DISPLAY_MS       = 3500;

type KioskPhase =
  | 'IDLE'
  | 'FACE_FOUND'
  | 'LIVENESS_OK'
  | 'RECOGNIZING'
  | 'SUCCESS'
  | 'ERROR'
  | 'OFFLINE';

interface StoredWorkerDescriptor {
  workerId: string;
  workerName: string;
  descriptor: number[];
  photo?: string;
}

// ─────────────────────────────────────────────────────────────
// Cosine distance
// ─────────────────────────────────────────────────────────────
function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

// ─────────────────────────────────────────────────────────────
// Main Kiosk Screen
// ─────────────────────────────────────────────────────────────
export default function KioskScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [kioskConfig, setKioskConfig]     = useState<KioskConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [descriptors, setDescriptors]     = useState<StoredWorkerDescriptor[]>([]);
  const [descriptorsLoaded, setDescriptorsLoaded] = useState(false);

  // Settings ref — populated after loading, used by buildAndWritePunch
  const settingsRef = useRef<OrgSettings>({ shifts: [], enableBreakTracking: false });
  // Workers ref — used by retryOfflineQueue
  const workersRef = useRef<Worker[]>([]);

  const [phase, setPhase]       = useState<KioskPhase>('IDLE');
  const [statusMsg, setStatusMsg] = useState('Stand in front of camera');
  const [faceInFrame, setFaceInFrame] = useState(false);
  const [successData, setSuccessData] = useState<{
    name: string; punchType: 'IN' | 'OUT'; time: string;
  } | null>(null);

  const livenessState = useRef<{ seenOpen: boolean; startMs: number }>({ seenOpen: false, startMs: 0 });
  const processingRef = useRef(false);
  const lastPunchMs   = useRef(0);
  const frameTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  const [clock, setClock]       = useState('');
  const [pinModal, setPinModal] = useState(false);
  const [pin, setPin]           = useState('');
  const [pinError, setPinError] = useState('');

  // ── Clock ─────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Load kiosk config ─────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(KIOSK_CONFIG_KEY);
        if (raw) setKioskConfig(JSON.parse(raw));
      } catch (e) {
        console.error('Kiosk config load error:', e);
      } finally {
        setConfigLoading(false);
      }
    };
    load();
  }, []);

  // ── Load workers, settings, descriptors ──────────────────
  useEffect(() => {
    if (!kioskConfig) return;
    const loadDescriptors = async () => {
      try {
        const [workers, settings] = await Promise.all([
          dbService.getWorkers(kioskConfig.tenantId),
          dbService.getOrgSettings(kioskConfig.tenantId),
        ]);

        settingsRef.current = settings;
        workersRef.current  = workers;

        const branchWorkers = workers.filter(
          (w) =>
            (!kioskConfig.branchId || w.branchId === kioskConfig.branchId) &&
            w.status === 'ACTIVE' &&
            (w as any).faceDescriptor?.length > 0,
        );

        const loaded: StoredWorkerDescriptor[] = branchWorkers.map((w) => ({
          workerId:   w.id,
          workerName: w.name,
          descriptor: (w as any).faceDescriptor as number[],
          photo:      (w as any).facePhotoBase64 ?? undefined,
        }));

        setDescriptors(loaded);
        setDescriptorsLoaded(true);
        console.log(`Loaded ${loaded.length} face descriptors`);
      } catch (e) {
        console.error('Descriptor load error:', e);
        setDescriptorsLoaded(true);
      }
    };
    loadDescriptors();
  }, [kioskConfig]);

  // ── Retry offline queue on reconnect ─────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener(async (state) => {
      if (state.isConnected && kioskConfig) {
        await retryOfflineQueue(settingsRef.current, workersRef.current);
      }
    });
    return () => unsub();
  }, [kioskConfig]);

  // ── Frame loop ────────────────────────────────────────────
  const startFrameLoop = useCallback(() => {
    if (frameTimer.current) return;
    frameTimer.current = setInterval(async () => {
      if (processingRef.current || !cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.3, base64: false, skipProcessing: true,
        });
        if (!photo?.uri) return;
        await detectFace(photo.uri);
      } catch { /* silent frame skip */ }
    }, FPS_INTERVAL_MS);
  }, []);

  const stopFrameLoop = useCallback(() => {
    if (frameTimer.current) {
      clearInterval(frameTimer.current);
      frameTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (permission?.granted && descriptorsLoaded && kioskConfig) {
      startFrameLoop();
    }
    return () => stopFrameLoop();
  }, [permission, descriptorsLoaded, kioskConfig]);

  // ── Face detection + liveness ─────────────────────────────
  const detectFace = async (uri: string) => {
    if (processingRef.current) return;
    if (Date.now() - lastPunchMs.current < COOLDOWN_MS) return;

    let faces: any[] = [];
    try {
      faces = await FaceDetector.detect(uri, {
        performanceMode: 'fast',
        landmarkMode: 'all',
        classificationMode: 'all',
      });
    } catch { return; }

    if (faces.length === 0) {
      if (faceInFrame) {
        setFaceInFrame(false);
        setPhase('IDLE');
        setStatusMsg('Stand in front of camera');
        livenessState.current = { seenOpen: false, startMs: 0 };
      }
      return;
    }

    const face       = faces[0];
    const leftOpen   = face.leftEyeOpenProbability  ?? 0;
    const rightOpen  = face.rightEyeOpenProbability ?? 0;

    if (!faceInFrame) {
      setFaceInFrame(true);
      setPhase('FACE_FOUND');
      setStatusMsg('Hold still...');
      livenessState.current = { seenOpen: false, startMs: Date.now() };
    }

    const ls      = livenessState.current;
    const elapsed = Date.now() - ls.startMs;

    if (!ls.seenOpen) {
      if (leftOpen > LIVENESS_OPEN_THRESHOLD && rightOpen > LIVENESS_OPEN_THRESHOLD) {
        livenessState.current.seenOpen = true;
      }
    } else {
      if (leftOpen < LIVENESS_CLOSE_THRESHOLD && rightOpen < LIVENESS_CLOSE_THRESHOLD) {
        await runRecognition(uri);
        return;
      }
    }

    if (elapsed > LIVENESS_TIMEOUT_MS) {
      setPhase('ERROR');
      setStatusMsg('Please blink naturally');
      livenessState.current = { seenOpen: false, startMs: Date.now() };
      setTimeout(() => {
        setPhase('IDLE');
        setStatusMsg('Stand in front of camera');
        setFaceInFrame(false);
      }, 2500);
    }
  };

  // ── Recognition ───────────────────────────────────────────
  const runRecognition = async (uri: string) => {
    processingRef.current = true;
    setPhase('RECOGNIZING');
    setStatusMsg('Identifying...');

    try {
      const faces = await FaceDetector.detect(uri, {
        performanceMode: 'accurate',
        landmarkMode: 'all',
        classificationMode: 'all',
      });

      if (faces.length === 0) throw new Error('No face in recognition frame');

      const liveDescriptor = buildLandmarkDescriptor(faces[0]);

      let bestDist  = Infinity;
      let bestMatch: StoredWorkerDescriptor | null = null;

      for (const stored of descriptors) {
        if (stored.descriptor.length !== liveDescriptor.length) continue;
        const dist = cosineDistance(liveDescriptor, stored.descriptor);
        if (dist < bestDist) { bestDist = dist; bestMatch = stored; }
      }

      if (!bestMatch || bestDist > RECOGNITION_THRESHOLD) {
        setPhase('ERROR');
        setStatusMsg('Face not recognized. Try again.');
        setTimeout(() => {
          setPhase('IDLE');
          setStatusMsg('Stand in front of camera');
          setFaceInFrame(false);
          processingRef.current = false;
          livenessState.current = { seenOpen: false, startMs: 0 };
        }, 3000);
        return;
      }

      await recordPunch(bestMatch.workerId, bestMatch.workerName);

    } catch (e) {
      console.error('Recognition error:', e);
      setPhase('ERROR');
      setStatusMsg('Error. Please try again.');
      setTimeout(() => {
        setPhase('IDLE');
        setStatusMsg('Stand in front of camera');
        setFaceInFrame(false);
        processingRef.current = false;
        livenessState.current = { seenOpen: false, startMs: 0 };
      }, 3000);
    }
  };

  // ── Build landmark descriptor ─────────────────────────────
  const buildLandmarkDescriptor = (face: any): number[] => {
    const box = face.frame ?? face.boundingBox ?? { width: 1, height: 1, left: 0, top: 0 };
    const W = box.width  || 1;
    const H = box.height || 1;
    const L = box.left   || 0;
    const T = box.top    || 0;

    const normalize = (pt: { x: number; y: number } | undefined): number[] => {
      if (!pt) return [0, 0];
      return [(pt.x - L) / W, (pt.y - T) / H];
    };

    const lm = face.landmarks ?? {};
    return [
      ...normalize(lm.LEFT_EYE),
      ...normalize(lm.RIGHT_EYE),
      ...normalize(lm.NOSE_BASE),
      ...normalize(lm.MOUTH_LEFT),
      ...normalize(lm.MOUTH_RIGHT),
      ...normalize(lm.LEFT_EAR),
      ...normalize(lm.RIGHT_EAR),
      ...normalize(lm.LEFT_CHEEK),
      ...normalize(lm.RIGHT_CHEEK),
      face.leftEyeOpenProbability  ?? 0,
      face.rightEyeOpenProbability ?? 0,
      face.smilingProbability      ?? 0,
      (face.headEulerAngleY ?? 0) / 180,
      (face.headEulerAngleZ ?? 0) / 180,
    ];
  };

  // ── Record punch — uses shared kioskPunchService ──────────
  const recordPunch = async (workerId: string, workerName: string) => {
    if (!kioskConfig) return;

    const now     = new Date();
    const today   = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    // Use shared determinePunchType instead of inline logic
    const punchType = await determinePunchType(kioskConfig.tenantId, workerId, today);

    const punch: OfflinePunch = {
      id:               `${kioskConfig.tenantId}_${workerId}_${now.getTime()}`,
      tenantId:         kioskConfig.tenantId,
      workerId,
      workerName,
      branchId:         kioskConfig.branchId,
      terminalId:       kioskConfig.terminalId,
      punchType,
      timestamp:        now.toISOString(),
      isLivenessPassed: true,
      method:           'Face Scan',
    };

    // Online → buildAndWritePunch, offline → saveToOfflineQueue
    const netState = await NetInfo.fetch();
    let offline = false;

    if (netState.isConnected) {
      try {
        // Find full worker object for shift/compliance logic
        const workerObj = workersRef.current.find((w) => w.id === workerId)
          ?? ({ id: workerId, name: workerName, shiftId: 'default' } as unknown as Worker);
        await buildAndWritePunch(punch, settingsRef.current, workerObj);
      } catch {
        await saveToOfflineQueue(punch);
        offline = true;
      }
    } else {
      await saveToOfflineQueue(punch);
      offline = true;
    }

    lastPunchMs.current = Date.now();
    setPhase(offline ? 'OFFLINE' : 'SUCCESS');
    setSuccessData({ name: workerName, punchType, time: timeStr });
    setStatusMsg(`${punchType === 'IN' ? 'Welcome' : 'Goodbye'}, ${workerName}!`);

    setTimeout(() => {
      setPhase('IDLE');
      setStatusMsg('Stand in front of camera');
      setFaceInFrame(false);
      setSuccessData(null);
      processingRef.current = false;
      livenessState.current = { seenOpen: false, startMs: 0 };
    }, SUCCESS_DISPLAY_MS);
  };

  // ── PIN exit ──────────────────────────────────────────────
  const handlePinDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) validatePin(next);
  };

  const validatePin = async (entered: string) => {
    if (!kioskConfig) return;
    if (entered === kioskConfig.adminPin) {
      stopFrameLoop();
      await AsyncStorage.removeItem(KIOSK_CONFIG_KEY);
      router.replace('/(admin)');
    } else {
      setPinError('Incorrect PIN. Try again.');
      setPin('');
    }
  };

  // ── Guards ────────────────────────────────────────────────
  if (configLoading) return (
    <View style={s.fullCenter}>
      <Text style={s.loadingTxt}>Loading kiosk...</Text>
    </View>
  );

  if (!kioskConfig) return (
    <View style={s.fullCenter}>
      <Ionicons name="qr-code-outline" size={48} color="#6B7280" />
      <Text style={s.loadingTxt}>Kiosk not configured.</Text>
      <Text style={s.loadingSub}>Pair this device from Settings → Terminals.</Text>
      <Pressable style={s.setupBtn} onPress={() => router.replace('/(admin)/settings')}>
        <Text style={s.setupBtnTxt}>Go to Settings</Text>
      </Pressable>
    </View>
  );

  if (!permission) return (
    <View style={s.fullCenter}>
      <Text style={s.loadingTxt}>Checking camera...</Text>
    </View>
  );

  if (!permission.granted) return (
    <View style={s.fullCenter}>
      <Ionicons name="camera-outline" size={48} color="#6B7280" />
      <Text style={s.loadingTxt}>Camera permission required.</Text>
      <Pressable style={s.setupBtn} onPress={requestPermission}>
        <Text style={s.setupBtnTxt}>Grant Permission</Text>
      </Pressable>
    </View>
  );

  const ovalBorderColor =
    phase === 'SUCCESS' || phase === 'OFFLINE'                                    ? '#22C55E'
    : phase === 'ERROR'                                                           ? '#EF4444'
    : phase === 'FACE_FOUND' || phase === 'LIVENESS_OK' || phase === 'RECOGNIZING' ? '#FACC15'
    : 'rgba(255,255,255,0.4)';

  const statusBg =
    phase === 'SUCCESS' || phase === 'OFFLINE' ? 'rgba(21,128,61,0.85)'
    : phase === 'ERROR'                        ? 'rgba(185,28,28,0.85)'
    : phase === 'RECOGNIZING'                  ? 'rgba(37,99,235,0.85)'
    : 'rgba(0,0,0,0.55)';

  // ─────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
      <View style={s.vignette} pointerEvents="none" />

      {/* Top Bar */}
      <View style={s.topBar}>
        <View>
          <Text style={s.orgName}>{kioskConfig.orgName}</Text>
          <Text style={s.branchName}>{kioskConfig.branchName} · {kioskConfig.terminalName}</Text>
        </View>
        <View style={s.topRight}>
          <Text style={s.clock}>{clock}</Text>
          {!descriptorsLoaded && (
            <View style={s.loadingPill}>
              <Text style={s.loadingPillTxt}>Loading faces…</Text>
            </View>
          )}
        </View>
      </View>

      {/* Oval */}
      <View style={s.ovalWrap} pointerEvents="none">
        <View style={[s.oval, { borderColor: ovalBorderColor }]}>
          {phase === 'RECOGNIZING' && <View style={s.scanLine} />}
        </View>
      </View>

      {/* Status */}
      <View style={s.statusWrap} pointerEvents="none">
        <View style={[s.statusBox, { backgroundColor: statusBg }]}>
          {phase === 'RECOGNIZING' && (
            <Ionicons name="scan-outline" size={14} color="#fff" style={{ marginRight: 6 }} />
          )}
          {(phase === 'SUCCESS' || phase === 'OFFLINE') && (
            <Ionicons name="checkmark-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
          )}
          {phase === 'ERROR' && (
            <Ionicons name="alert-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
          )}
          <Text style={s.statusTxt}>{statusMsg}</Text>
        </View>
        {phase === 'OFFLINE' && (
          <View style={s.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color="#FBBF24" />
            <Text style={s.offlineTxt}>Offline — punch saved locally</Text>
          </View>
        )}
      </View>

      {/* Success card */}
      {successData && (phase === 'SUCCESS' || phase === 'OFFLINE') && (
        <View style={s.successCard}>
          <View style={[s.successAvatar, { backgroundColor: successData.punchType === 'IN' ? '#22C55E' : '#EF4444' }]}>
            <Text style={s.successAvatarTxt}>{successData.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={s.successName}>{successData.name}</Text>
          <View style={[s.successBadge, { backgroundColor: successData.punchType === 'IN' ? '#DCFCE7' : '#FEE2E2' }]}>
            <Ionicons
              name={successData.punchType === 'IN' ? 'log-in-outline' : 'log-out-outline'}
              size={14}
              color={successData.punchType === 'IN' ? '#15803D' : '#DC2626'}
            />
            <Text style={[s.successBadgeTxt, { color: successData.punchType === 'IN' ? '#15803D' : '#DC2626' }]}>
              {successData.punchType === 'IN' ? 'Checked IN' : 'Checked OUT'}
            </Text>
          </View>
          <Text style={s.successTime}>{successData.time}</Text>
        </View>
      )}

      {/* Enrolled badge */}
      {descriptorsLoaded && (
        <View style={s.descriptorBadge} pointerEvents="none">
          <Ionicons name="people-outline" size={11} color="rgba(255,255,255,0.7)" />
          <Text style={s.descriptorTxt}>{descriptors.length} enrolled</Text>
        </View>
      )}

      {/* Liveness hint */}
      {phase === 'FACE_FOUND' && (
        <View style={s.livenessHint} pointerEvents="none">
          <Text style={s.livenessHintTxt}>👁 Blink to verify</Text>
        </View>
      )}

      {/* Exit button */}
      <Pressable style={s.exitBtn} onPress={() => { setPinModal(true); setPin(''); setPinError(''); }}>
        <Ionicons name="lock-closed-outline" size={16} color="rgba(255,255,255,0.7)" />
        <Text style={s.exitBtnTxt}>Exit</Text>
      </Pressable>

      {/* PIN Modal */}
      <Modal visible={pinModal} transparent animationType="fade" onRequestClose={() => setPinModal(false)}>
        <View style={s.pinOverlay}>
          <View style={s.pinCard}>
            <Text style={s.pinTitle}>Admin PIN</Text>
            <Text style={s.pinSub}>Enter 4-digit PIN to exit kiosk mode</Text>
            <View style={s.pinDots}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[s.pinDot, pin.length > i && s.pinDotFilled]} />
              ))}
            </View>
            {!!pinError && <Text style={s.pinError}>{pinError}</Text>}
            <View style={s.numpad}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, idx) => (
                <Pressable
                  key={idx}
                  style={[s.numKey, d === '' && { backgroundColor: 'transparent', elevation: 0 }]}
                  onPress={() => {
                    if (d === '') return;
                    if (d === '⌫') { setPin((p) => p.slice(0, -1)); setPinError(''); }
                    else handlePinDigit(d);
                  }}
                  disabled={d === ''}
                >
                  <Text style={s.numKeyTxt}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.pinCancelBtn} onPress={() => setPinModal(false)}>
              <Text style={s.pinCancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#000' },
  fullCenter: { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  loadingSub: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  setupBtn:   { marginTop: 12, backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  setupBtnTxt:{ color: '#fff', fontWeight: '700', fontSize: 14 },
  vignette:   { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  topBar:     { position: 'absolute', top: 48, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24 },
  orgName:    { color: '#fff', fontSize: 18, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  branchName: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  topRight:   { alignItems: 'flex-end', gap: 6 },
  clock:      { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  loadingPill:{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  loadingPillTxt: { color: '#FBBF24', fontSize: 10, fontWeight: '700' },
  ovalWrap:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', marginTop: -60 },
  oval:       { width: OVAL_W, height: OVAL_H, borderRadius: OVAL_W / 2, borderWidth: 3, overflow: 'hidden', position: 'relative' },
  scanLine:   { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(250,204,21,0.7)', top: '50%' },
  statusWrap: { position: 'absolute', bottom: SCREEN_H * 0.22, left: 0, right: 0, alignItems: 'center', gap: 8 },
  statusBox:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 24 },
  statusTxt:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  offlinePill:{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' },
  offlineTxt: { color: '#FBBF24', fontSize: 11, fontWeight: '600' },
  successCard:{ position: 'absolute', bottom: SCREEN_H * 0.06, left: 24, right: 24, backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 24, padding: 20, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, elevation: 10 },
  successAvatar:   { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  successAvatarTxt:{ color: '#fff', fontSize: 26, fontWeight: '900' },
  successName:     { fontSize: 20, fontWeight: '900', color: '#111827' },
  successBadge:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  successBadgeTxt: { fontSize: 13, fontWeight: '800' },
  successTime:     { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  descriptorBadge: { position: 'absolute', bottom: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  descriptorTxt:   { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600' },
  livenessHint:    { position: 'absolute', top: SCREEN_H * 0.62, left: 0, right: 0, alignItems: 'center' },
  livenessHintTxt: { color: '#fff', fontSize: 13, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  exitBtn:    { position: 'absolute', bottom: 24, left: 24, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  exitBtnTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  pinCard:    { backgroundColor: '#1F2937', borderRadius: 24, padding: 28, width: 320, alignItems: 'center', gap: 10 },
  pinTitle:   { color: '#fff', fontSize: 18, fontWeight: '900' },
  pinSub:     { color: '#9CA3AF', fontSize: 12, textAlign: 'center' },
  pinDots:    { flexDirection: 'row', gap: 14, marginVertical: 8 },
  pinDot:     { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#4F46E5', backgroundColor: 'transparent' },
  pinDotFilled:{ backgroundColor: '#4F46E5' },
  pinError:   { color: '#EF4444', fontSize: 12, fontWeight: '600' },
  numpad:     { flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 10, marginTop: 8, justifyContent: 'center' },
  numKey:     { width: 68, height: 56, borderRadius: 14, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center', elevation: 2 },
  numKeyTxt:  { color: '#fff', fontSize: 20, fontWeight: '800' },
  pinCancelBtn:{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 24 },
  pinCancelTxt:{ color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
});
