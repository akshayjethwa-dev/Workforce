// app/(admin)/attendance/kiosk.web.tsx
// ⚠️ This file ONLY runs on web (browser). .web.tsx extension ensures this.
import React, { useRef, useEffect, useState, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { Worker, OrgSettings } from '../../../src/types/index';
import {
  OfflinePunch,
  buildAndWritePunch, saveToOfflineQueue, retryOfflineQueue,
  determinePunchType, checkCooldown, handleLeaveCancellation,
} from '../../../src/services/kioskPunchService';

// ─────────────────────────────────────────────────────────────
// Lazy-load @vladmandic/human (web-only, heavy lib)
// ─────────────────────────────────────────────────────────────
let humanInstance: any = null;

const getHuman = async () => {
  if (humanInstance) return humanInstance;
  const { default: Human } = await import('@vladmandic/human');
  humanInstance = new Human({
    modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models/',
    face: {
      enabled: true,
      detector: { rotation: false },
      mesh: { enabled: true },
      iris: { enabled: true },
      description: { enabled: true },
      emotion: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: true },
  });
  await humanInstance.load();
  await humanInstance.warmup();
  return humanInstance;
};

// ─────────────────────────────────────────────────────────────
// Audio feedback
// ─────────────────────────────────────────────────────────────
const playSound = (type: 'SUCCESS' | 'ERROR') => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'SUCCESS') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(250, ctx.currentTime);
      osc.frequency.setValueAtTime(200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    }
  } catch (e) { /* silent */ }
};

// ─────────────────────────────────────────────────────────────
// Types & Helpers
// ─────────────────────────────────────────────────────────────
type LivenessState = 'SCANNING' | 'CHALLENGE';
type Phase = 'IDLE' | 'SUCCESS' | 'ERROR' | 'COOLDOWN' | 'OFFLINE';

interface RecentPunch {
  name: string; type: 'IN' | 'OUT'; time: Date;
}

// Safely extract landmarks regardless of how Firebase stored it
const getLandmarks = (w: any): number[] => {
  const fd = w.faceDescriptor;
  if (!fd) return [];
  if (Array.isArray(fd)) return fd;
  if (typeof fd === 'object' && Array.isArray(fd.landmarks)) return fd.landmarks;
  return [];
};

// ─────────────────────────────────────────────────────────────
// Main Web Kiosk — ADMIN SESSION (no pairing / AsyncStorage)
// ─────────────────────────────────────────────────────────────
export default function KioskWebScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ branchId?: string }>();
  
  // CHANGED: Removed orgSettings from useAuth to fix TS error
  const { profile } = useAuth();

  const tenantId  = profile?.tenantId ?? '';
  const branchId  = (params.branchId as string) ?? 'default';

  // DOM refs
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // State
  const [workers, setWorkers]               = useState<Worker[]>([]);
  const [settings, setSettings]             = useState<OrgSettings>({ shifts: [], enableBreakTracking: false });
  const [modelsLoaded, setModelsLoaded]     = useState(false);
  const [workersLoaded, setWorkersLoaded]   = useState(false);
  const [feedback, setFeedback]             = useState('Initializing...');
  const [livenessState, setLivenessState]   = useState<LivenessState>('SCANNING');
  const [phase, setPhase]                   = useState<Phase>('IDLE');
  const [recentPunches, setRecentPunches]   = useState<RecentPunch[]>([]);
  const [successData, setSuccessData]       = useState<{ name: string; punchType: 'IN' | 'OUT'; time: string } | null>(null);
  const [clock, setClock]                   = useState('');

  // Refs
  const processingRef       = useRef(false);
  const targetWorkerRef     = useRef<Worker | null>(null);
  const livenessTimerRef    = useRef<number>(0);
  const failedAttemptsRef   = useRef<Record<string, number>>({});
  const workersRef          = useRef<Worker[]>([]);
  const settingsRef         = useRef<OrgSettings>({ shifts: [], enableBreakTracking: false });

  // ── Clock ──────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Guard: must be logged in ──────────────────────────────
  useEffect(() => {
    if (!tenantId) {
      router.replace('/(auth)/login' as any);
    }
  }, [tenantId]);

  // ── Load workers + settings ────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    const init = async () => {
      try {
        setFeedback('Loading AI models...');
        const [fetchedWorkers, fetchedSettings] = await Promise.all([
          dbService.getWorkers(tenantId),
          dbService.getOrgSettings(tenantId),
          getHuman().then(() => setModelsLoaded(true)),
        ]);

        const branchWorkers = fetchedWorkers
          .map((w) => ({
            ...w,
            faceDescriptor: getLandmarks(w)
          }))
          .filter((w) =>
            (branchId === 'default' || (w.branchId ?? 'default') === branchId) &&
            w.status === 'ACTIVE' &&
            (w as any).faceDescriptor.length > 0
          );

        workersRef.current  = branchWorkers;
        settingsRef.current = fetchedSettings;
        setWorkers(branchWorkers);
        setSettings(fetchedSettings);
        setWorkersLoaded(true);
        setFeedback(
          `Ready · ${branchWorkers.length} faces loaded`
        );
      } catch (e) {
        console.error('Init error:', e);
        setFeedback('Init failed. Check console.');
      }
    };
    init();

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch((err) => {
        console.error('Camera error:', err);
        setFeedback('Camera blocked. Check permissions.');
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [tenantId, branchId]);

  // ── Retry offline queue on reconnect ─────────────────────
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && tenantId) {
        retryOfflineQueue(settingsRef.current, workersRef.current);
      }
    });
    return () => unsub();
  }, [tenantId]);

  // ── Scan loop (~7fps) ─────────────────────────────────────
  useEffect(() => {
    if (!modelsLoaded) return;

    const interval = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || processingRef.current) return;
      if (workersRef.current.length === 0) return;

      try {
        const human = await getHuman();
        const result = await human.detect(video);

        if (!result?.face?.length) {
          if (livenessState === 'CHALLENGE') {
            setLivenessState('SCANNING');
            targetWorkerRef.current = null;
            setFeedback('Place face in circle');
          }
          return;
        }

        const embedding: number[] = result.face[0].embedding;
        const hasBlinked: boolean = result.gesture?.some((g: any) =>
          g.gesture.includes('blink')
        ) ?? false;

        let bestMatch: Worker | null = null;
        let bestScore = 0;
        
        for (const w of workersRef.current) {
          const fd = (w as any).faceDescriptor;
          if (!fd || !Array.isArray(fd) || !fd.length) continue;
          
          if (fd.length !== embedding.length) continue; 
          
          const score = human.match.similarity(embedding, fd);
          if (score > bestScore) { bestScore = score; bestMatch = w; }
        }

        if (!bestMatch || bestScore < 0.65) {
          if (livenessState === 'CHALLENGE') {
            setLivenessState('SCANNING');
            setFeedback('Place face in circle');
            targetWorkerRef.current = null;
          }
          return;
        }

        if (livenessState === 'SCANNING') {
          if (settingsRef.current?.strictLiveness) {
            setLivenessState('CHALLENGE');
            targetWorkerRef.current = bestMatch;
            livenessTimerRef.current = Date.now();
            setFeedback(`Hi ${bestMatch.name.split(' ')[0]}, please BLINK to verify...`);
            playSound('SUCCESS');
          } else {
            await handlePunch(bestMatch, 'Face Scan');
          }
        } else if (livenessState === 'CHALLENGE' && targetWorkerRef.current) {
          if (bestMatch.id === targetWorkerRef.current.id) {
            if (hasBlinked) {
              setFeedback('Liveness verified!');
              setLivenessState('SCANNING');
              await handlePunch(bestMatch, 'Face Scan');
              targetWorkerRef.current = null;
            } else if (Date.now() - livenessTimerRef.current > 3000) {
              await handleSpoofFailure(targetWorkerRef.current);
            }
          } else {
            setLivenessState('SCANNING');
            setFeedback('Place face in circle');
          }
        }
      } catch (e) {
        console.error('Scan loop error:', e);
        processingRef.current = false;
      }
    }, 150);

    return () => clearInterval(interval);
  }, [modelsLoaded, livenessState]);

  // ── Spoof failure handler ─────────────────────────────────
  const handleSpoofFailure = async (worker: Worker) => {
    processingRef.current = true;
    playSound('ERROR');
    const fails = (failedAttemptsRef.current[worker.id] ?? 0) + 1;
    failedAttemptsRef.current[worker.id] = fails;

    if (fails >= 3 && tenantId) {
      setFeedback('🚨 SPOOFING ATTEMPT LOGGED!');
      await dbService.addNotification({
        tenantId,
        title: '⚠️ Security Alert: Liveness Failed',
        message: `Multiple failed liveness checks for ${worker.name}. Possible proxy punch attempt.`,
        type: 'ALERT',
        createdAt: new Date().toISOString(),
        read: false,
      });
      failedAttemptsRef.current[worker.id] = 0;
    } else {
      setFeedback('Verification failed. Please blink clearly.');
    }

    setTimeout(() => {
      setLivenessState('SCANNING');
      setFeedback('Place face in circle');
      processingRef.current = false;
      targetWorkerRef.current = null;
    }, 2500);
  };

  // ── Punch handler ─────────────────────────────────────────
  const handlePunch = useCallback(async (worker: Worker, method: 'Face Scan' | 'QR Badge') => {
    if (processingRef.current || !tenantId) return;
    processingRef.current = true;
    setFeedback(`Identifying ${worker.name.split(' ')[0]}...`);

    try {
      const today = new Date().toISOString().split('T')[0];

      const cooldownSecs = await checkCooldown(tenantId, worker.id, today);
      if (cooldownSecs !== null) {
        playSound('ERROR');
        setFeedback(`Wait ${cooldownSecs}s before next punch`);
        setPhase('COOLDOWN');
        setTimeout(() => {
          setPhase('IDLE');
          setFeedback('Place face in circle');
          processingRef.current = false;
        }, cooldownSecs * 1000);
        return;
      }

      await handleLeaveCancellation(tenantId, worker.id, today, worker);
      const punchType = await determinePunchType(tenantId, worker.id, today);

      const now = new Date();
      const punch: OfflinePunch = {
        id: `${tenantId}_${worker.id}_${now.getTime()}`,
        tenantId,
        workerId: worker.id,
        workerName: worker.name,
        branchId,
        terminalId: 'admin-session',
        punchType,
        timestamp: now.toISOString(),
        isLivenessPassed: true,
        method,
      };

      const netState = await NetInfo.fetch();
      let offline = false;
      if (netState.isConnected) {
        try {
          await buildAndWritePunch(punch, settingsRef.current, worker);
        } catch {
          await saveToOfflineQueue(punch);
          offline = true;
        }
      } else {
        await saveToOfflineQueue(punch);
        offline = true;
      }

      playSound('SUCCESS');
      const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      setSuccessData({ name: worker.name, punchType, time: timeStr });
      setPhase(offline ? 'OFFLINE' : 'SUCCESS');
      setFeedback(punchType === 'IN' ? `Welcome, ${worker.name.split(' ')[0]}!` : `Goodbye, ${worker.name.split(' ')[0]}!`);
      setRecentPunches((prev) => [{ name: worker.name, type: punchType, time: now }, ...prev].slice(0, 10));

      setTimeout(() => {
        setPhase('IDLE');
        setFeedback('Place face in circle');
        setSuccessData(null);
        processingRef.current = false;
        targetWorkerRef.current = null;
      }, 3500);
    } catch (e: any) {
      console.error('Punch error:', e);
      playSound('ERROR');
      setPhase('ERROR');
      setFeedback(`Error: ${e.message ?? 'Unknown'}`);
      setTimeout(() => {
        setPhase('IDLE');
        setFeedback('Place face in circle');
        processingRef.current = false;
      }, 3000);
    }
  }, [tenantId, branchId]);

  // ── Exit kiosk → back to dashboard ───────────────────────
  const handleExit = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    router.back();
  };

  // ── Guard: not logged in ──────────────────────────────────
  if (!tenantId) {
    return (
      <div style={css.fullCenter}>
        <p style={css.loadingTxt}>Not authenticated.</p>
        <button style={css.setupBtn} onClick={() => router.replace('/(auth)/login' as any)}>
          Go to Login
        </button>
      </div>
    );
  }

  const ovalBorder =
    phase === 'SUCCESS' || phase === 'OFFLINE'   ? '#22C55E'
    : phase === 'ERROR'                          ? '#EF4444'
    : livenessState === 'CHALLENGE'              ? '#A855F7'
    : 'rgba(255,255,255,0.35)';

  const statusBg =
    phase === 'SUCCESS' || phase === 'OFFLINE'   ? 'rgba(21,128,61,0.9)'
    : phase === 'ERROR'                          ? 'rgba(185,28,28,0.9)'
    : livenessState === 'CHALLENGE'              ? 'rgba(109,40,217,0.9)'
    : 'rgba(0,0,0,0.6)';

  // CHANGED: Use settings state instead of authOrgSettings
  const branchLabel =
    settings?.branches?.find((b: any) => b.id === branchId)?.name
    ?? (branchId === 'default' ? 'All Branches' : branchId);

  // ─────────────────────────────────────────────────────────
  return (
    <div style={css.root}>
      {/* ── Left: Camera pane ── */}
      <div style={css.cameraPane}>
        <video ref={videoRef} autoPlay playsInline muted style={css.video} />

        {/* Top bar */}
        <div style={css.topBar}>
          <div>
            <p style={css.orgName}>{profile?.companyName ?? 'Attendance Kiosk'}</p>
            <p style={css.branchName}>{branchLabel} · Admin Session</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={css.clock}>{clock}</p>
            {!modelsLoaded && <p style={css.loadingPill}>Loading AI…</p>}
          </div>
        </div>

        {/* Oval guide */}
        <div style={css.ovalWrap}>
          <div style={{ ...css.oval, borderColor: ovalBorder }}>
            <div style={css.ovalInner} />
          </div>
          <p style={{ ...css.ovalHint, ...(livenessState === 'CHALLENGE' ? css.ovalHintChallenge : {}) }}>
            {livenessState === 'CHALLENGE' ? 'Keep face in circle & BLINK' : 'Place face in circle'}
          </p>
        </div>

        {/* Status bar */}
        <div style={css.statusBar}>
          <div style={{ ...css.statusBox, backgroundColor: statusBg }}>
            <span style={css.statusTxt}>{feedback}</span>
          </div>
          {phase === 'OFFLINE' && (
            <div style={css.offlinePill}>☁ Offline — punch saved locally</div>
          )}
        </div>

        {/* Success overlay */}
        {successData && (phase === 'SUCCESS' || phase === 'OFFLINE') && (
          <div style={css.successOverlay}>
            <div style={css.successCard}>
              <div style={{
                ...css.successAvatar,
                backgroundColor: successData.punchType === 'IN' ? '#22C55E' : '#EF4444',
              }}>
                <span style={css.successInitial}>{successData.name.charAt(0).toUpperCase()}</span>
              </div>
              <p style={css.successName}>{successData.name}</p>
              <div style={{
                ...css.successBadge,
                backgroundColor: successData.punchType === 'IN' ? '#DCFCE7' : '#FEE2E2',
              }}>
                <span style={{
                  ...css.successBadgeTxt,
                  color: successData.punchType === 'IN' ? '#15803D' : '#DC2626',
                }}>
                  {successData.punchType === 'IN' ? '✓ Checked IN' : '✓ Checked OUT'}
                </span>
              </div>
              <p style={css.successTime}>{successData.time}</p>
            </div>
          </div>
        )}

        {/* Exit button — just goes back, no PIN needed (admin is already authenticated) */}
        <button style={css.exitBtn} onClick={handleExit}>
          ✕ Exit Kiosk
        </button>
      </div>

      {/* ── Right: Activity pane ── */}
      <div style={css.activityPane}>
        <div style={css.activityHeader}>
          <p style={css.activityTitle}>Live Activity</p>
          <p style={css.activitySub}>
            <span style={css.onlineDot} /> Admin Session
          </p>
        </div>
        <div style={css.activityList}>
          {recentPunches.length === 0 ? (
            <div style={css.emptyActivity}>
              <p style={{ fontSize: 32 }}>🕐</p>
              <p style={{ color: '#6B7280', marginTop: 8 }}>Awaiting first scan...</p>
            </div>
          ) : (
            recentPunches.map((punch, idx) => (
              <div key={idx} style={css.activityRow}>
                <div style={{
                  ...css.activityIcon,
                  backgroundColor: punch.type === 'IN' ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.15)',
                }}>
                  <span style={{ fontSize: 18 }}>{punch.type === 'IN' ? '→' : '←'}</span>
                </div>
                <div>
                  <p style={css.activityName}>{punch.name}</p>
                  <p style={css.activityMeta}>
                    {punch.type === 'IN' ? 'Checked In' : 'Checked Out'} · {punch.time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline styles (web — no StyleSheet)
// ─────────────────────────────────────────────────────────────
const css: Record<string, React.CSSProperties> = {
  root:           { display: 'flex', height: '100vh', backgroundColor: '#000', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' },
  fullCenter:     { display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827', gap: 12 },
  loadingTxt:     { color: '#fff', fontSize: 18, fontWeight: 700 },
  setupBtn:       { marginTop: 12, backgroundColor: '#4F46E5', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },

  // Camera pane
  cameraPane:     { position: 'relative', flex: 2, overflow: 'hidden', backgroundColor: '#111' },
  video:          { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },

  // Top bar
  topBar:         { position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px' },
  orgName:        { color: '#fff', fontSize: 20, fontWeight: 900, margin: 0, textShadow: '0 1px 4px rgba(0,0,0,0.8)' },
  branchName:     { color: 'rgba(255,255,255,0.65)', fontSize: 12, margin: '2px 0 0' },
  clock:          { color: '#fff', fontSize: 22, fontWeight: 800, margin: 0, fontVariant: 'tabular-nums', textShadow: '0 1px 4px rgba(0,0,0,0.8)' },
  loadingPill:    { color: '#FBBF24', fontSize: 11, fontWeight: 700, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: '3px 10px', marginTop: 4, display: 'inline-block' },

  // Oval
  ovalWrap:       { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', marginTop: -40 },
  oval:           { width: 280, height: 360, borderRadius: '50%', borderWidth: 3, borderStyle: 'solid', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.3s' },
  ovalInner:      { width: 256, height: 336, borderRadius: '50%', border: '2px dashed rgba(255,255,255,0.35)' },
  ovalHint:       { marginTop: 20, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 700, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 24, padding: '8px 20px' },
  ovalHintChallenge: { backgroundColor: 'rgba(109,40,217,0.8)' },

  // Status bar
  statusBar:      { position: 'absolute', bottom: 80, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  statusBox:      { display: 'inline-flex', alignItems: 'center', padding: '12px 28px', borderRadius: 32, transition: 'background-color 0.3s' },
  statusTxt:      { color: '#fff', fontSize: 16, fontWeight: 700 },
  offlinePill:    { color: '#FBBF24', fontSize: 12, fontWeight: 600, backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 20, padding: '5px 14px' },

  // Success overlay
  successOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 20 },
  successCard:    { backgroundColor: '#fff', borderRadius: 28, padding: 32, textAlign: 'center', minWidth: 280, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' },
  successAvatar:  { width: 80, height: 80, borderRadius: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' },
  successInitial: { color: '#fff', fontSize: 32, fontWeight: 900 },
  successName:    { fontSize: 24, fontWeight: 900, color: '#111827', margin: '0 0 10px' },
  successBadge:   { display: 'inline-block', padding: '6px 18px', borderRadius: 20, marginBottom: 10 },
  successBadgeTxt:{ fontSize: 14, fontWeight: 800 },
  successTime:    { fontSize: 14, color: '#6B7280', fontWeight: 600, margin: 0 },

  // Exit button
  exitBtn:        { position: 'absolute', bottom: 20, left: 20, background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  // Activity pane
  activityPane:   { flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#030712', borderLeft: '1px solid rgba(255,255,255,0.07)', minWidth: 300 },
  activityHeader: { padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#000' },
  activityTitle:  { color: '#fff', fontSize: 18, fontWeight: 800, margin: '0 0 4px' },
  activitySub:    { color: '#6B7280', fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 6 },
  onlineDot:      { display: 'inline-block', width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  activityList:   { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  emptyActivity:  { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' },
  activityRow:    { display: 'flex', alignItems: 'center', gap: 12, backgroundColor: '#111827', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 14 },
  activityIcon:   { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  activityName:   { color: '#fff', fontWeight: 700, fontSize: 14, margin: '0 0 2px' },
  activityMeta:   { color: '#6B7280', fontSize: 12, margin: 0 },
};