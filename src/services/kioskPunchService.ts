// src/services/kioskPunchService.ts
// Shared punch logic for both kiosk.native.tsx and kiosk.web.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dbService } from './db';
import { attendanceLogic } from './attendanceLogic';
import { AttendanceRecord, OrgSettings, Worker } from '../types/index';

const OFFLINE_QUEUE_KEY = 'OFFLINE_PUNCH_QUEUE';
export const KIOSK_CONFIG_KEY = 'KIOSK_CONFIG';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface KioskConfig {
  tenantId: string;
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalName: string;
  adminPin: string;
  orgName: string;
}

export interface OfflinePunch {
  id: string;
  tenantId: string;
  workerId: string;
  workerName: string;
  branchId: string;
  terminalId: string;
  punchType: 'IN' | 'OUT';
  timestamp: string;
  isLivenessPassed: boolean;
  method: 'Face Scan' | 'QR Badge';
}

export interface PunchResult {
  success: boolean;
  punchType: 'IN' | 'OUT';
  offline: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Build Firestore attendance record from a punch
// ─────────────────────────────────────────────────────────────
export const buildAndWritePunch = async (
  punch: OfflinePunch,
  settings: OrgSettings,
  worker: Worker,
): Promise<void> => {
  const today = punch.timestamp.split('T')[0];
  const recordId = `${punch.tenantId}_${punch.workerId}_${today}`;

  // Fetch existing record for this worker+date
  const existing: AttendanceRecord | null = await (dbService as any)
    .getAttendanceByDate(punch.tenantId, today)
    .then((recs: AttendanceRecord[]) =>
      recs.find((r) => r.workerId === punch.workerId) ?? null
    ).catch(() => null);

  const currentTimeline = existing?.timeline ?? [];
  const newTimeline = [
    ...currentTimeline,
    {
      timestamp: punch.timestamp,
      type: punch.punchType,
      device: `Kiosk:${punch.terminalId} (${punch.method})`,
      isLivenessPassed: punch.isLivenessPassed,
      branchId: punch.branchId,
    },
  ];

  const baseRecord: AttendanceRecord = existing ?? {
    id: recordId,
    tenantId: punch.tenantId,
    workerId: punch.workerId,
    workerName: punch.workerName,
    date: today,
    shiftId: worker.shiftId ?? 'default',
    timeline: [],
    status: 'ABSENT',
    lateStatus: { isLate: false, lateByMins: 0, penaltyApplied: false },
    hours: { gross: 0, net: 0, overtime: 0 },
  };

  baseRecord.timeline = newTimeline;

  const shift =
    settings.shifts?.find((s) => s.id === worker.shiftId) ??
    settings.shifts?.[0];

  if (!shift) throw new Error('No shift config found for worker');

  const lateCount = await dbService.getMonthlyLateCount(
    punch.tenantId,
    punch.workerId,
  );

  const finalRecord = attendanceLogic.processDailyStatus(
    baseRecord,
    shift,
    lateCount,
    settings.enableBreakTracking,
    worker,
    settings,
  );

  await dbService.markAttendance(finalRecord);
};

// ─────────────────────────────────────────────────────────────
// Save to offline queue
// ─────────────────────────────────────────────────────────────
export const saveToOfflineQueue = async (punch: OfflinePunch): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: OfflinePunch[] = raw ? JSON.parse(raw) : [];
    queue.push(punch);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Offline queue save error:', e);
  }
};

// ─────────────────────────────────────────────────────────────
// Retry offline queue — call when network comes back
// ─────────────────────────────────────────────────────────────
export const retryOfflineQueue = async (
  settings: OrgSettings,
  workers: Worker[],
): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return;
    const queue: OfflinePunch[] = JSON.parse(raw);
    if (queue.length === 0) return;

    const remaining: OfflinePunch[] = [];
    for (const punch of queue) {
      const worker = workers.find((w) => w.id === punch.workerId);
      if (!worker) { remaining.push(punch); continue; }
      try {
        await buildAndWritePunch(punch, settings, worker);
      } catch {
        remaining.push(punch);
      }
    }
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    if (remaining.length < queue.length) {
      console.log(`Synced ${queue.length - remaining.length} offline punches`);
    }
  } catch (e) {
    console.error('Retry offline queue error:', e);
  }
};

// ─────────────────────────────────────────────────────────────
// Determine IN or OUT based on existing attendance record
// ─────────────────────────────────────────────────────────────
export const determinePunchType = async (
  tenantId: string,
  workerId: string,
  today: string,
): Promise<'IN' | 'OUT'> => {
  try {
    const records: AttendanceRecord[] = await (dbService as any)
      .getAttendanceByDate(tenantId, today);
    const existing = records.find((r) => r.workerId === workerId);
    if (!existing?.timeline?.length) return 'IN';
    const last = [...existing.timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ).pop();
    return last?.type === 'IN' ? 'OUT' : 'IN';
  } catch {
    return 'IN';
  }
};

// ─────────────────────────────────────────────────────────────
// Check cooldown (prevents double-punch within 10s)
// ─────────────────────────────────────────────────────────────
export const checkCooldown = async (
  tenantId: string,
  workerId: string,
  today: string,
  cooldownSecs = 10,
): Promise<number | null> => {
  // Returns seconds remaining if in cooldown, null if clear
  try {
    const records: AttendanceRecord[] = await (dbService as any)
      .getAttendanceByDate(tenantId, today);
    const existing = records.find((r) => r.workerId === workerId);
    if (!existing?.timeline?.length) return null;
    const last = [...existing.timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ).pop();
    if (!last) return null;
    const diffSecs = (Date.now() - new Date(last.timestamp).getTime()) / 1000;
    return diffSecs < cooldownSecs ? Math.ceil(cooldownSecs - diffSecs) : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// Handle leave cancellation when worker punches IN on a leave day
// ─────────────────────────────────────────────────────────────
export const handleLeaveCancellation = async (
  tenantId: string,
  workerId: string,
  today: string,
  worker: Worker,
): Promise<void> => {
  try {
    const records: AttendanceRecord[] = await (dbService as any)
      .getAttendanceByDate(tenantId, today);
    const existing = records.find((r) => r.workerId === workerId);
    if (!existing || existing.status !== 'ON_LEAVE') return;
    if (!existing.leaveInfo?.isPaid) return;

    const rawType = existing.leaveInfo.type.toLowerCase();
    if (rawType === 'lwp' || !worker.leaveBalances) return;

    const lType = rawType as 'cl' | 'sl' | 'pl';
    const currentBal = worker.leaveBalances[lType] ?? 0;
    await dbService.updateWorker(workerId, {
      leaveBalances: { ...worker.leaveBalances, [lType]: currentBal + 1 },
    });
    await dbService.addNotification({
      tenantId,
      title: 'Leave Automatically Cancelled',
      message: `${worker.name} punched in, cancelling ${lType.toUpperCase()} leave. 1 day refunded.`,
      type: 'INFO',
      createdAt: new Date().toISOString(),
      read: false,
    });
  } catch (e) {
    console.error('Leave cancellation error:', e);
  }
};
