// app/(admin)/attendance/index.tsx
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  View, Text, Pressable, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, Alert,
  TextInput, ScrollView,
} from 'react-native';
import { FlatList as RNFlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { attendanceLogic } from '../../../src/services/attendanceLogic';
import { Worker, AttendanceRecord, OrgSettings, Punch } from '../../../src/types/index';

// ─────────────────────────────────────────────────────────────
// SafeFlatList — bypasses react-native-css-interop JSX wrapper
// that injects columnWrapperStyle on single-column lists (web crash)
// ─────────────────────────────────────────────────────────────
function SafeFlatList<T>(props: React.ComponentProps<typeof RNFlatList<T>>) {
  const { columnWrapperStyle: _dropped, ...safeProps } = props as any;
  return React.createElement(RNFlatList, safeProps);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const fmt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

const fmtDate = (d: Date) => d.toISOString().split('T')[0];

const addDays = (date: Date, n: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

type StatusKey =
  | 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE'
  | 'PENDING' | 'WEEKLY_OFF' | 'PUBLIC_HOLIDAY'
  | 'HOLIDAY_WORKED' | 'IN_PROGRESS';

const STATUS_META: Record<StatusKey, { label: string; color: string; bg: string }> = {
  PRESENT:        { label: 'Present',     color: '#15803D', bg: '#DCFCE7' },
  HALF_DAY:       { label: 'Half Day',    color: '#B45309', bg: '#FEF3C7' },
  ABSENT:         { label: 'Absent',      color: '#6B7280', bg: '#F3F4F6' },
  ON_LEAVE:       { label: 'On Leave',    color: '#7C3AED', bg: '#EDE9FE' },
  PENDING:        { label: 'Pending',     color: '#2563EB', bg: '#DBEAFE' },
  WEEKLY_OFF:     { label: 'Weekly Off',  color: '#475569', bg: '#E2E8F0' },
  PUBLIC_HOLIDAY: { label: 'Holiday',     color: '#9333EA', bg: '#F3E8FF' },
  HOLIDAY_WORKED: { label: 'Holiday OT',  color: '#15803D', bg: '#BBF7D0' },
  IN_PROGRESS:    { label: 'In Progress', color: '#2563EB', bg: '#DBEAFE' },
};

const getStatusKey = (record: AttendanceRecord | undefined, isInside: boolean): StatusKey => {
  if (!record) return 'ABSENT';
  if (isInside) return 'IN_PROGRESS';
  if (record.status === 'ON_LEAVE') return 'ON_LEAVE';
  if (record.status === 'PRESENT') return 'PRESENT';
  if (record.status === 'HALF_DAY') return 'HALF_DAY';
  if (record.status === 'WEEKLY_OFF') return 'WEEKLY_OFF';
  if (record.status === 'PUBLIC_HOLIDAY') return 'PUBLIC_HOLIDAY';
  if (record.status === 'HOLIDAY_WORKED') return 'HOLIDAY_WORKED';
  if ((record.timeline?.length ?? 0) > 0) return 'PENDING';
  return 'ABSENT';
};

// ─────────────────────────────────────────────────────────────
// Worker Row Card
// ─────────────────────────────────────────────────────────────
interface RowProps {
  worker: Worker;
  record?: AttendanceRecord;
  actionLoading: string | null;
  onPunch: (worker: Worker, type: 'IN' | 'OUT') => void;
  onLeave: (worker: Worker) => void;
  onRowPress: (worker: Worker, record?: AttendanceRecord) => void;
}

const WorkerRow = memo(({ worker, record, actionLoading, onPunch, onLeave, onRowPress }: RowProps) => {
  const [expanded, setExpanded] = useState(false);
  const sorted: Punch[] = [...(record?.timeline ?? [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const lastPunch = sorted[sorted.length - 1];
  const isInside = lastPunch?.type === 'IN';
  const isOnLeave = record?.status === 'ON_LEAVE';
  const statusKey = getStatusKey(record, isInside);
  const meta = STATUS_META[statusKey];
  const firstIn = sorted.find((p) => p.type === 'IN');
  const lastOut = [...sorted].reverse().find((p) => p.type === 'OUT');
  const isLoading = actionLoading === worker.id;

  return (
    <Pressable style={row.card} onPress={() => onRowPress(worker, record)}>
      {/* Top */}
      <View style={row.top}>
        <View style={[row.avatar, { backgroundColor: isInside ? '#22C55E' : '#E5E7EB' }]}>
          <Text style={[row.avatarText, { color: isInside ? '#fff' : '#374151' }]}>
            {worker.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={row.name} numberOfLines={1}>{worker.name}</Text>
          <Text style={row.dept} numberOfLines={1}>{worker.designation} · {worker.department}</Text>
        </View>
        <View style={[row.badge, { backgroundColor: meta.bg }]}>
          <Text style={[row.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Times summary */}
      {record && !isOnLeave && sorted.length > 0 && (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <View style={row.timeRow}>
            <View style={row.timeBox}>
              <Text style={row.timeLabel}>First In</Text>
              <Text style={row.timeVal}>{firstIn ? fmt(firstIn.timestamp) : '--:--'}</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color="#D1D5DB" />
            <View style={[row.timeBox, { alignItems: 'flex-end' }]}>
              <Text style={row.timeLabel}>Last Out</Text>
              <Text style={[row.timeVal, !lastOut && { color: '#22C55E' }]}>
                {lastOut ? fmt(lastOut.timestamp) : 'Active'}
              </Text>
            </View>
            <View style={row.hoursBadge}>
              <Text style={row.hoursText}>{(record.hours?.net ?? 0).toFixed(1)}h</Text>
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={14} color="#9CA3AF"
            />
          </View>

          {/* Expanded punch log */}
          {expanded && (
            <View style={row.punchLog}>
              {sorted.map((punch, idx) => (
                <View key={idx} style={row.punchItem}>
                  <View style={[row.punchDot, { backgroundColor: punch.type === 'IN' ? '#22C55E' : '#EF4444' }]} />
                  <Text style={row.punchType}>{punch.type}</Text>
                  {punch.isOutOfGeofence && (
                    <View style={row.geofenceBadge}>
                      <Ionicons name="location-outline" size={9} color="#B45309" />
                      <Text style={row.geofenceText}>Out of Zone</Text>
                    </View>
                  )}
                  {punch.device === 'MANUAL_OVERRIDE_BY_ADMIN' && (
                    <View style={row.manualBadge}>
                      <Text style={row.manualText}>Regulated</Text>
                    </View>
                  )}
                  <Text style={row.punchTime}>{fmt(punch.timestamp)}</Text>
                </View>
              ))}
              {record.lateStatus?.isLate && (
                <View style={row.lateBadge}>
                  <Ionicons name="time-outline" size={11} color="#B45309" />
                  <Text style={row.lateText}>Late by {record.lateStatus.lateByMins} min</Text>
                </View>
              )}
            </View>
          )}
        </Pressable>
      )}

      {/* Action buttons */}
      <View style={row.actions}>
        <Pressable
          style={[row.actionBtn, row.inBtn, (isInside || isLoading) && row.actionDisabled]}
          onPress={() => onPunch(worker, 'IN')}
          disabled={isInside || isLoading}
        >
          {isLoading
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Ionicons name="log-in-outline" size={14} color={isInside ? '#9CA3AF' : '#fff'} />
               <Text style={[row.actionText, isInside && { color: '#9CA3AF' }]}> Check In</Text></>
          }
        </Pressable>

        <Pressable
          style={[row.actionBtn, row.outBtn, (!isInside || isLoading) && row.actionDisabled]}
          onPress={() => onPunch(worker, 'OUT')}
          disabled={!isInside || isLoading}
        >
          <Ionicons name="log-out-outline" size={14} color={!isInside ? '#9CA3AF' : '#DC2626'} />
          <Text style={[row.actionText, { color: !isInside ? '#9CA3AF' : '#DC2626' }]}> Check Out</Text>
        </Pressable>

        <Pressable style={row.leaveBtn} onPress={() => onLeave(worker)}>
          <Ionicons name="calendar-outline" size={16} color="#7C3AED" />
        </Pressable>
      </View>
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
type FilterDept = string;
type FilterBranch = string;

export default function AttendanceScreen() {
  const { profile } = useAuth();

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord>>({});
  const [settings, setSettings] = useState<OrgSettings>({ shifts: [], enableBreakTracking: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState<FilterDept>('ALL');
  const [filterBranch, setFilterBranch] = useState<FilterBranch>('ALL');

  // Override modal state
  const [overrideModal, setOverrideModal] = useState<{
    visible: boolean;
    worker: Worker | null;
    record?: AttendanceRecord;
    inTime: string;
    outTime: string;
    status: string;
  }>({ visible: false, worker: null, inTime: '', outTime: '', status: '' });

  // ── Load data ─────────────────────────────────────────────
  const loadData = useCallback(async (manual = false) => {
    if (!profile?.tenantId) return;
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      const dateStr = fmtDate(selectedDate);
      const [fetchedWorkers, fetchedAttendance, fetchedSettings] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getAttendanceByDate(profile.tenantId, dateStr),
        dbService.getOrgSettings(profile.tenantId),
      ]);
      setWorkers(fetchedWorkers);
      setSettings(fetchedSettings);
      const map: Record<string, AttendanceRecord> = {};
      (fetchedAttendance as AttendanceRecord[]).forEach((r) => { map[r.workerId] = r; });
      setAttendanceMap(map);
    } catch (e) {
      console.error('Attendance load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Departments & branches for filters ────────────────────
  const departments = useMemo(() => {
    const depts = new Set(workers.map((w) => w.department).filter(Boolean));
    return ['ALL', ...Array.from(depts)];
  }, [workers]);

  const branches = useMemo(() => {
    const br = new Set(workers.map((w) => w.branchId).filter(Boolean) as string[]);
    return ['ALL', ...Array.from(br)];
  }, [workers]);

  // ── Filtered workers ──────────────────────────────────────
  const filteredWorkers = useMemo(() =>
    workers.filter((w) => {
      if (filterDept !== 'ALL' && w.department !== filterDept) return false;
      if (filterBranch !== 'ALL' && w.branchId !== filterBranch) return false;
      return true;
    }), [workers, filterDept, filterBranch]);

  // ── Summary counts ────────────────────────────────────────
  const summary = useMemo(() => {
    let present = 0, absent = 0, late = 0, onLeave = 0, halfDay = 0;
    filteredWorkers.forEach((w) => {
      const r = attendanceMap[w.id];
      if (!r) { absent++; return; }
      if (r.status === 'ON_LEAVE') { onLeave++; return; }
      if (r.status === 'PRESENT') { present++; }
      if (r.status === 'HALF_DAY') { halfDay++; }
      if (r.status === 'ABSENT') { absent++; }
      if (r.lateStatus?.isLate) { late++; }
    });
    return { present, absent, late, onLeave, halfDay };
  }, [filteredWorkers, attendanceMap]);

  // ── Punch handler ─────────────────────────────────────────
  const handlePunch = useCallback(async (worker: Worker, type: 'IN' | 'OUT') => {
    if (!profile?.tenantId) return;
    setActionLoading(worker.id);
    try {
      const dateStr = fmtDate(selectedDate);
      const recordId = `${profile.tenantId}_${worker.id}_${dateStr}`;
      const now = new Date();
      const existingRecord = attendanceMap[worker.id];
      const currentTimeline = existingRecord?.timeline ?? [];
      const newTimeline = [...currentTimeline, {
        timestamp: now.toISOString(),
        type,
        device: 'Mobile App (Admin)',
      }];
      const shift = settings.shifts.find((s) => s.id === worker.shiftId) ?? settings.shifts[0];
      const lateCount = await dbService.getMonthlyLateCount(profile.tenantId, worker.id);
      const baseRecord: AttendanceRecord = existingRecord ?? {
        id: recordId, tenantId: profile.tenantId, workerId: worker.id,
        workerName: worker.name, date: dateStr,
        shiftId: worker.shiftId ?? 'default', timeline: [],
        status: 'ABSENT',
        lateStatus: { isLate: false, lateByMins: 0, penaltyApplied: false },
        hours: { gross: 0, net: 0, overtime: 0 },
      };
      baseRecord.timeline = newTimeline;
      const finalRecord = attendanceLogic.processDailyStatus(
        baseRecord, shift, lateCount, settings.enableBreakTracking, worker, settings
      );
      await dbService.markAttendance(finalRecord);
      setAttendanceMap((prev) => ({ ...prev, [worker.id]: finalRecord }));

      if (finalRecord.lateStatus.isLate && !existingRecord?.lateStatus?.isLate) {
        await dbService.addNotification({
          tenantId: profile.tenantId, title: 'Late Arrival',
          message: `${worker.name} checked in late.`,
          type: 'INFO', createdAt: new Date().toISOString(), read: false,
        });
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to record punch.');
    } finally {
      setActionLoading(null);
    }
  }, [profile, selectedDate, attendanceMap, settings]);

  // ── Mark on leave ─────────────────────────────────────────
  const handleLeave = useCallback((worker: Worker) => {
    Alert.alert(
      'Mark On Leave',
      `Mark ${worker.name} as Leave Without Pay (LWP) for this day?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark LWP', style: 'destructive',
          onPress: async () => {
            if (!profile?.tenantId) return;
            const dateStr = fmtDate(selectedDate);
            const recordId = `${profile.tenantId}_${worker.id}_${dateStr}`;
            const leaveRecord: AttendanceRecord = {
              id: recordId, tenantId: profile.tenantId,
              workerId: worker.id, workerName: worker.name,
              date: dateStr, shiftId: worker.shiftId ?? 'default',
              timeline: [], status: 'ON_LEAVE',
              lateStatus: { isLate: false, lateByMins: 0, penaltyApplied: false },
              hours: { gross: 0, net: 0, overtime: 0 },
              leaveInfo: { type: 'LWP', isPaid: false, reason: 'Quick Action (Admin)' },
            };
            await dbService.markAttendance(leaveRecord);
            setAttendanceMap((prev) => ({ ...prev, [worker.id]: leaveRecord }));
          },
        },
      ]
    );
  }, [profile, selectedDate]);

  // ── Row press → override modal ────────────────────────────
  const handleRowPress = useCallback((worker: Worker, record?: AttendanceRecord) => {
    const sorted = [...(record?.timeline ?? [])].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const firstIn = sorted.find((p) => p.type === 'IN');
    const lastOut = [...sorted].reverse().find((p) => p.type === 'OUT');
    setOverrideModal({
      visible: true, worker, record,
      inTime: firstIn ? fmt(firstIn.timestamp) : '',
      outTime: lastOut ? fmt(lastOut.timestamp) : '',
      status: record?.status ?? 'ABSENT',
    });
  }, []);

  // ── Save override ─────────────────────────────────────────
  const handleSaveOverride = async () => {
    const { worker, record, status, inTime, outTime } = overrideModal;
    if (!worker || !profile?.tenantId) return;
    const dateStr = fmtDate(selectedDate);
    const recordId = `${profile.tenantId}_${worker.id}_${dateStr}`;

    const parseTime = (timeStr: string) => {
      if (!timeStr) return null;
      const [h, m] = timeStr.replace(/AM|PM/i, '').trim().split(':').map(Number);
      const d = new Date(selectedDate);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };

    const newTimeline: Punch[] = [];
    const inISO = parseTime(inTime);
    const outISO = parseTime(outTime);
    if (inISO) newTimeline.push({ timestamp: inISO, type: 'IN', device: 'MANUAL_OVERRIDE_BY_ADMIN' });
    if (outISO) newTimeline.push({ timestamp: outISO, type: 'OUT', device: 'MANUAL_OVERRIDE_BY_ADMIN' });

    const baseRecord: AttendanceRecord = record ?? {
      id: recordId, tenantId: profile.tenantId,
      workerId: worker.id, workerName: worker.name,
      date: dateStr, shiftId: worker.shiftId ?? 'default',
      timeline: [], status: 'ABSENT',
      lateStatus: { isLate: false, lateByMins: 0, penaltyApplied: false },
      hours: { gross: 0, net: 0, overtime: 0 },
    };

    const updated: AttendanceRecord = {
      ...baseRecord,
      timeline: newTimeline.length > 0 ? newTimeline : baseRecord.timeline,
      status: status as AttendanceRecord['status'],
    };

    if (newTimeline.length >= 2) {
      const shift = settings.shifts.find((s) => s.id === worker.shiftId) ?? settings.shifts[0];
      const lateCount = await dbService.getMonthlyLateCount(profile.tenantId, worker.id);
      const processed = attendanceLogic.processDailyStatus(
        updated, shift, lateCount, settings.enableBreakTracking, worker, settings
      );
      await dbService.markAttendance(processed);
      setAttendanceMap((prev) => ({ ...prev, [worker.id]: processed }));
    } else {
      await dbService.markAttendance(updated);
      setAttendanceMap((prev) => ({ ...prev, [worker.id]: updated }));
    }
    setOverrideModal((p) => ({ ...p, visible: false }));
    Alert.alert('Done', 'Attendance updated successfully.');
  };

  // ── Render ────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: Worker }) => (
    <WorkerRow
      worker={item}
      record={attendanceMap[item.id]}
      actionLoading={actionLoading}
      onPunch={handlePunch}
      onLeave={handleLeave}
      onRowPress={handleRowPress}
    />
  ), [attendanceMap, actionLoading, handlePunch, handleLeave, handleRowPress]);

  const ListHeader = (
    <View>
      {/* Date navigator */}
      <View style={s.dateNav}>
        <Pressable style={s.dateNavBtn} onPress={() => setSelectedDate((d) => addDays(d, -1))}>
          <Ionicons name="chevron-back" size={20} color="#374151" />
        </Pressable>
        <View style={s.dateCenter}>
          <Text style={s.dateTxt}>
            {selectedDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          {fmtDate(selectedDate) !== fmtDate(new Date()) && (
            <Pressable onPress={() => setSelectedDate(new Date())}>
              <Text style={s.todayLink}>Back to Today</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={[s.dateNavBtn, fmtDate(selectedDate) === fmtDate(new Date()) && { opacity: 0.3 }]}
          onPress={() => setSelectedDate((d) => addDays(d, 1))}
          disabled={fmtDate(selectedDate) === fmtDate(new Date())}
        >
          <Ionicons name="chevron-forward" size={20} color="#374151" />
        </Pressable>
      </View>

      {/* Summary cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.summaryScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {[
          { label: 'Present', value: summary.present, color: '#15803D', bg: '#DCFCE7', icon: 'checkmark-circle-outline' },
          { label: 'Absent', value: summary.absent, color: '#6B7280', bg: '#F3F4F6', icon: 'close-circle-outline' },
          { label: 'Late', value: summary.late, color: '#B45309', bg: '#FEF3C7', icon: 'time-outline' },
          { label: 'Leave', value: summary.onLeave, color: '#7C3AED', bg: '#EDE9FE', icon: 'calendar-outline' },
          { label: 'Half Day', value: summary.halfDay, color: '#D97706', bg: '#FEF9C3', icon: 'remove-circle-outline' },
        ].map((c) => (
          <View key={c.label} style={[s.summaryCard, { backgroundColor: c.bg }]}>
            <Ionicons name={c.icon as any} size={18} color={c.color} />
            <Text style={[s.summaryVal, { color: c.color }]}>{c.value}</Text>
            <Text style={[s.summaryLabel, { color: c.color }]}>{c.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Branch filter */}
      {branches.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          {branches.map((b) => (
            <Pressable key={b} style={[s.pill, filterBranch === b && s.pillActive]} onPress={() => setFilterBranch(b)}>
              <Text style={[s.pillTxt, filterBranch === b && s.pillTxtActive]}>
                {b === 'ALL' ? 'All Branches' : b}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Department filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
        {departments.map((d) => (
          <Pressable key={d} style={[s.pill, filterDept === d && s.pillActive]} onPress={() => setFilterDept(d)}>
            <Text style={[s.pillTxt, filterDept === d && s.pillTxtActive]}>
              {d === 'ALL' ? 'All Departments' : d}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Worker count */}
      <View style={s.countRow}>
        <Text style={s.countTxt}>{filteredWorkers.length} workers</Text>
      </View>
    </View>
  );

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={s.empty}>
        <Ionicons name="people-outline" size={40} color="#D1D5DB" />
        <Text style={s.emptyTxt}>No workers found for this filter.</Text>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {loading && workers.length === 0 ? (
        <View style={s.loadingScreen}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      ) : (
        // ✅ FIX: SafeFlatList replaces FlatList — strips columnWrapperStyle
        //    injected by react-native-css-interop on web single-column lists
        <SafeFlatList
          data={filteredWorkers}
          keyExtractor={(item: Worker) => item.id}
          renderItem={renderItem}
          numColumns={1}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} colors={['#4F46E5']} tintColor="#4F46E5" />
          }
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      {/* ── Override / Edit Modal ── */}
      <Modal
        visible={overrideModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setOverrideModal((p) => ({ ...p, visible: false }))}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            {/* Header */}
            <View style={s.modalHeader}>
              <View>
                <Text style={s.modalTitle}>Edit Attendance</Text>
                <Text style={s.modalSub}>{overrideModal.worker?.name}</Text>
              </View>
              <Pressable onPress={() => setOverrideModal((p) => ({ ...p, visible: false }))}>
                <Ionicons name="close" size={22} color="#6B7280" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {/* Status override */}
              <Text style={s.fieldLabel}>Status</Text>
              <View style={s.statusGrid}>
                {(['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE'] as StatusKey[]).map((st) => (
                  <Pressable
                    key={st}
                    style={[s.statusChip, overrideModal.status === st && { backgroundColor: STATUS_META[st].bg, borderColor: STATUS_META[st].color }]}
                    onPress={() => setOverrideModal((p) => ({ ...p, status: st }))}
                  >
                    <Text style={[s.statusChipTxt, overrideModal.status === st && { color: STATUS_META[st].color }]}>
                      {STATUS_META[st].label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Time override */}
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>IN Time (HH:MM AM/PM)</Text>
              <TextInput
                style={s.timeInput}
                value={overrideModal.inTime}
                onChangeText={(v) => setOverrideModal((p) => ({ ...p, inTime: v }))}
                placeholder="e.g. 09:15 AM"
                placeholderTextColor="#9CA3AF"
              />

              <Text style={s.fieldLabel}>OUT Time (HH:MM AM/PM)</Text>
              <TextInput
                style={s.timeInput}
                value={overrideModal.outTime}
                onChangeText={(v) => setOverrideModal((p) => ({ ...p, outTime: v }))}
                placeholder="e.g. 06:00 PM"
                placeholderTextColor="#9CA3AF"
              />

              <View style={s.infoBox}>
                <Ionicons name="information-circle-outline" size={14} color="#2563EB" />
                <Text style={s.infoTxt}>
                  Setting both IN and OUT times will recalculate hours and late status automatically.
                </Text>
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setOverrideModal((p) => ({ ...p, visible: false }))}>
                <Text style={s.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable style={s.saveBtn} onPress={handleSaveOverride}>
                <Ionicons name="checkmark-outline" size={16} color="#fff" />
                <Text style={s.saveBtnTxt}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Worker Row Styles
// ─────────────────────────────────────────────────────────────
const row = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#F3F4F6',
    padding: 14, marginHorizontal: 16,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  name: { fontSize: 14, fontWeight: '700', color: '#111827' },
  dept: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  timeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', borderRadius: 10,
    padding: 10, gap: 8, marginBottom: 10,
  },
  timeBox: { flex: 1 },
  timeLabel: { fontSize: 9, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase' },
  timeVal: { fontSize: 13, fontWeight: '800', color: '#111827', marginTop: 2 },
  hoursBadge: {
    backgroundColor: '#EEF2FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  hoursText: { fontSize: 11, fontWeight: '800', color: '#4F46E5' },
  punchLog: { paddingTop: 6, gap: 5, marginBottom: 6 },
  punchItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F9FAFB', borderRadius: 8,
    padding: 8, borderWidth: 1, borderColor: '#F3F4F6',
  },
  punchDot: { width: 7, height: 7, borderRadius: 4 },
  punchType: { fontSize: 11, fontWeight: '700', color: '#374151', flex: 1 },
  punchTime: { fontSize: 12, fontWeight: '800', color: '#111827', fontFamily: 'monospace' },
  geofenceBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FEF3C7', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  geofenceText: { fontSize: 9, fontWeight: '700', color: '#B45309' },
  manualBadge: {
    backgroundColor: '#DBEAFE', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  manualText: { fontSize: 9, fontWeight: '700', color: '#1D4ED8' },
  lateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7', borderRadius: 8,
    padding: 6, marginTop: 4,
  },
  lateText: { fontSize: 11, fontWeight: '700', color: '#B45309' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 10,
    borderRadius: 10,
  },
  inBtn: { backgroundColor: '#22C55E' },
  outBtn: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  actionDisabled: { backgroundColor: '#F3F4F6' },
  actionText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  leaveBtn: {
    flex: 0, width: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F3FF', borderRadius: 10,
    borderWidth: 1, borderColor: '#DDD6FE',
  },
});

// ─────────────────────────────────────────────────────────────
// Screen Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 40, paddingTop: 8 },

  // Date nav
  dateNav: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  dateNavBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTxt: { fontSize: 14, fontWeight: '800', color: '#111827' },
  todayLink: { fontSize: 11, color: '#4F46E5', fontWeight: '600', marginTop: 2 },

  // Summary
  summaryScroll: { paddingVertical: 12 },
  summaryCard: {
    alignItems: 'center', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, gap: 3, minWidth: 72,
  },
  summaryVal: { fontSize: 18, fontWeight: '900' },
  summaryLabel: { fontSize: 10, fontWeight: '700' },

  // Filter pills
  filterScroll: { paddingVertical: 6 },
  pill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  pillTxt: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  pillTxtActive: { color: '#fff' },

  countRow: { paddingHorizontal: 16, paddingVertical: 8 },
  countTxt: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },

  // Empty
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTxt: { fontSize: 14, color: '#9CA3AF' },

  // Override modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  modalSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#374151',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
  },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  statusChipTxt: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  timeInput: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, padding: 12, fontSize: 14,
    color: '#111827', fontWeight: '600', marginBottom: 10,
  },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#EFF6FF', borderRadius: 10,
    borderWidth: 1, borderColor: '#BFDBFE',
    padding: 10, marginTop: 4,
  },
  infoTxt: { fontSize: 11, color: '#1E40AF', flex: 1, lineHeight: 16 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1, padding: 14, backgroundColor: '#F3F4F6',
    borderRadius: 12, alignItems: 'center',
  },
  cancelBtnTxt: { fontSize: 14, fontWeight: '700', color: '#374151' },
  saveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    padding: 14, backgroundColor: '#4F46E5', borderRadius: 12,
  },
  saveBtnTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
