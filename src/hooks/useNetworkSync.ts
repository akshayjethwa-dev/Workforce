// src/hooks/useNetworkSync.ts
import { useEffect, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import {
  getPendingPunches,
  clearPendingPunch,
  incrementRetry,
  PendingPunch,
} from '../services/offlineQueue';
import { dbService } from '../services/db';
import { attendanceLogic } from '../services/attendanceLogic';
import { AttendanceRecord } from '../types/index'; // ← ADD THIS

const MAX_RETRIES = 3;

async function syncPunch(punch: PendingPunch): Promise<boolean> {
  try {
    const today    = punch.date;
    const recordId = `${punch.tenantId}_${punch.workerId}_${today}`;

    const todayRecords = await dbService.getTodayAttendance(punch.tenantId);
    const existing     = todayRecords.find((r: AttendanceRecord) => r.id === recordId); // ← TYPED

    const currentTimeline = existing?.timeline ?? [];
    const newTimeline = [
      ...currentTimeline,
      {
        timestamp:       punch.timestamp,
        type:            punch.type,
        device:          `${punch.device} [Offline Sync]`,
        location:        punch.location,
        isOutOfGeofence: false,
      },
    ];

    const settings = await dbService.getOrgSettings(punch.tenantId);
    const shift    = settings.shifts.find(s => s.id === punch.shiftId) || settings.shifts[0];

    if (!shift) throw new Error('No shift config found during sync');

    const lateCount = await dbService.getMonthlyLateCount(punch.tenantId, punch.workerId);

    const minWorker = {
      id:          punch.workerId,
      name:        punch.workerName,
      shiftId:     punch.shiftId,
      wageConfig:  { type: 'DAILY' as const, amount: 0, overtimeEligible: false, allowances: { travel: 0, food: 0, nightShift: 0 } },
      tenantId:    punch.tenantId,
      status:      'ACTIVE'     as const,
      phone:       '',
      dob:         '',
      gender:      'Male'       as const,
      category:    'Daily Wage' as const,
      department:  '',
      designation: '',
      joinedDate:  '',
    };

    const baseRecord: AttendanceRecord = { // ← TYPED
      id:         recordId,
      tenantId:   punch.tenantId,
      workerId:   punch.workerId,
      workerName: punch.workerName,
      date:       today,
      shiftId:    punch.shiftId,
      timeline:   newTimeline,
      status:     'ABSENT',
      lateStatus: existing?.lateStatus ?? { isLate: false, lateByMins: 0, penaltyApplied: false },
      hours:      { gross: 0, net: 0, overtime: 0 },
    };

    const finalRecord = attendanceLogic.processDailyStatus(
      baseRecord, shift, lateCount,
      settings.enableBreakTracking ?? false,
      minWorker as any,
      settings,
    );

    await dbService.markAttendance(finalRecord);
    return true;
  } catch (err) {
    console.error('[NetworkSync] syncPunch failed for', punch.id, err);
    return false;
  }
}

export function useNetworkSync() {
  const wasPreviouslyOffline = useRef(false);
  const isSyncing            = useRef(false);

  const runSync = async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    try {
      const pending = await getPendingPunches();
      if (pending.length === 0) return;

      console.log(`[NetworkSync] Syncing ${pending.length} offline punch(es)...`);

      let synced  = 0;
      let skipped = 0;

      for (const punch of pending) {
        if (punch.retries >= MAX_RETRIES) {
          await clearPendingPunch(punch.id);
          skipped++;
          continue;
        }

        const ok = await syncPunch(punch);
        if (ok) {
          await clearPendingPunch(punch.id);
          synced++;
        } else {
          await incrementRetry(punch.id);
        }
      }

      if (synced > 0) {
        Alert.alert(
          '✅ Offline Sync Complete',
          `${synced} offline punch${synced > 1 ? 'es' : ''} synced successfully.${skipped > 0 ? `\n${skipped} skipped after max retries.` : ''}`,
          [{ text: 'OK' }],
        );
      }
    } finally {
      isSyncing.current = false;
    }
  };

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = !!(state.isConnected && state.isInternetReachable);

      if (isOnline && wasPreviouslyOffline.current) {
        console.log('[NetworkSync] Back online — triggering sync...');
        runSync();
      }

      wasPreviouslyOffline.current = !isOnline;
    });

    NetInfo.fetch().then((state: NetInfoState) => {
      const isOnline = !!(state.isConnected && state.isInternetReachable);
      if (isOnline) runSync();
    });

    return () => unsubscribe();
  }, []);
}
