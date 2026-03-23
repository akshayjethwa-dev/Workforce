// app/(admin)/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  RefreshControl, Modal, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { dbService } from '../../src/services/db';
import { attendanceLogic } from '../../src/services/attendanceLogic';
import { OrgSettings } from '../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface Stats {
  total: number; present: number; halfDay: number;
  absent: number; late: number; pending: number; onLeave: number;
}

interface ActivityRow {
  id: string; workerName: string; currentHours: number;
  computedStatus: string; isLate: boolean; isCurrentlyIn: boolean;
  timeline: any[]; date: string;
}

// ─────────────────────────────────────────────────────────────
// Stat Card Component
// ─────────────────────────────────────────────────────────────
interface StatCardProps {
  iconName: string; value: number; label: string;
  subLabel: string; color: string; bg: string;
}

const StatCard = React.memo(({ iconName, value, label, subLabel, color, bg }: StatCardProps) => (
  <View style={styles.statCard}>
    <View style={[styles.statIconBadge, { backgroundColor: bg }]}>
      <Ionicons name={iconName as any} size={18} color={color} />
    </View>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statSubLabel}>{subLabel}</Text>
  </View>
));

// ─────────────────────────────────────────────────────────────
// Status Badge helper
// ─────────────────────────────────────────────────────────────
const getStatusBadge = (status: string): { text: string; bg: string; color: string } => {
  switch (status) {
    case 'PRESENT':  return { text: 'Present',   bg: '#DCFCE7', color: '#15803D' };
    case 'HALF_DAY': return { text: 'Half Day',  bg: '#FEF3C7', color: '#B45309' };
    case 'PENDING':  return { text: 'Pending',   bg: '#DBEAFE', color: '#1D4ED8' };
    case 'ON_LEAVE': return { text: 'On Leave',  bg: '#F3E8FF', color: '#7C3AED' };
    default:         return { text: 'Absent',    bg: '#FEE2E2', color: '#DC2626' };
  }
};

// ─────────────────────────────────────────────────────────────
// Main Dashboard
// ─────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const { profile, limits } = useAuth();
  const { width } = useWindowDimensions();

  const [stats, setStats] = useState<Stats>({
    total: 0, present: 0, halfDay: 0,
    absent: 0, late: 0, pending: 0, onLeave: 0,
  });
  const [recentActivity, setRecentActivity] = useState<ActivityRow[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [selectedDashboardBranch, setSelectedDashboardBranch] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Kiosk branch modal (admin-session kiosk) ──────────────
  const [showKioskModal, setShowKioskModal] = useState(false);
  const [selectedKioskBranch, setSelectedKioskBranch] = useState<string>('default');

  // ── Branch filter modal ───────────────────────────────────
  const [showBranchModal, setShowBranchModal] = useState(false);

  // ── Data Fetch + Stats Calculation ───────────────────────
  const refreshData = useCallback(async (isManual = false) => {
    if (!profile?.tenantId) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const [workers, attendance, settings] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getTodayAttendance(profile.tenantId),
        dbService.getOrgSettings(profile.tenantId),
      ]);

      setOrgSettings(settings);

      const activeWorkers = workers.filter(
        (w: any) =>
          w.status === 'ACTIVE' &&
          (selectedDashboardBranch === 'ALL' ||
            (w.branchId || 'default') === selectedDashboardBranch)
      );

      const total = activeWorkers.length;
      const activeWorkerIds = new Set(activeWorkers.map((w: any) => w.id));
      const filteredAttendance = (attendance as any[]).filter((r) =>
        activeWorkerIds.has(r.workerId)
      );

      let presentCount = 0, halfDayCount = 0, lateCount = 0;
      let onLeaveCount = 0, pendingCount = 0;

      const processedActivity: ActivityRow[] = filteredAttendance.map((record) => {
        const currentHours = attendanceLogic.calculateHours(
          record.timeline,
          settings.enableBreakTracking
        );

        const lastPunch =
          record.timeline?.length > 0
            ? record.timeline[record.timeline.length - 1]
            : null;
        const isCurrentlyIn = lastPunch?.type === 'IN';

        // Late detection
        let isLate = false;
        const shift =
          settings.shifts.find((s: any) => s.id === record.shiftId) ||
          settings.shifts[0];
        const firstPunch = record.timeline?.find((p: any) => p.type === 'IN');

        if (firstPunch && shift) {
          const punchTime = new Date(firstPunch.timestamp);
          const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
          const shiftStart = new Date(punchTime);
          shiftStart.setHours(shiftHour, shiftMin, 0, 0);
          const diffMins = Math.max(
            0,
            Math.floor((punchTime.getTime() - shiftStart.getTime()) / 60000)
          );
          isLate = diffMins > (shift.gracePeriodMins || 15);
        }

        // Status computation
        let computedStatus = 'ABSENT';
        if (record.status === 'ON_LEAVE') {
          computedStatus = 'ON_LEAVE';
        } else if (currentHours >= 6) {
          computedStatus = 'PRESENT';
        } else if (currentHours >= 4) {
          computedStatus = 'HALF_DAY';
        } else if (isCurrentlyIn) {
          computedStatus = 'PENDING';
        } else {
          computedStatus = 'ABSENT';
        }

        if (isLate) lateCount++;

        return {
          ...record,
          currentHours,
          computedStatus,
          isCurrentlyIn,
          isLate,
        };
      });

      processedActivity.forEach((r) => {
        if (r.computedStatus === 'PRESENT') presentCount++;
        else if (r.computedStatus === 'HALF_DAY') halfDayCount++;
        else if (r.computedStatus === 'PENDING') pendingCount++;
        else if (r.computedStatus === 'ON_LEAVE') onLeaveCount++;
      });

      const attended = presentCount + halfDayCount + pendingCount + onLeaveCount;
      const absentCount = Math.max(0, total - attended);

      setStats({
        total,
        present: presentCount,
        halfDay: halfDayCount,
        absent: absentCount,
        late: lateCount,
        pending: pendingCount,
        onLeave: onLeaveCount,
      });

      const sorted = [...processedActivity].sort((a, b) => {
        const getTime = (r: ActivityRow) =>
          r.timeline?.length > 0
            ? new Date(r.timeline[r.timeline.length - 1].timestamp).getTime()
            : new Date(r.date).getTime();
        return getTime(b) - getTime(a);
      });

      setRecentActivity(sorted);
    } catch (e) {
      console.error('Dashboard refresh error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, selectedDashboardBranch]);

  useEffect(() => { refreshData(); }, [refreshData]);

  // ── Kiosk Launch — routes to ADMIN-SESSION kiosk ─────────
  // Never routes to /kiosk (that is dedicated terminal only).
  // Mirrors original: onOpenKiosk(branchId) → ATTENDANCE_KIOSK screen
  const handleKioskLaunch = () => {
    const branches = orgSettings?.branches || [];
    if (branches.length > 1) {
      // Multiple branches → show branch picker modal first
      setSelectedKioskBranch(branches[0]?.id || 'default');
      setShowKioskModal(true);
    } else {
      // Single branch → launch directly
      const branchId = branches[0]?.id || 'default';
      router.push({
        pathname: '/(admin)/attendance/kiosk' as any,
        params: { branchId },
      });
    }
  };

  const handleKioskConfirm = () => {
    setShowKioskModal(false);
    router.push({
      pathname: '/(admin)/attendance/kiosk' as any,
      params: { branchId: selectedKioskBranch || 'default' },
    });
  };

  // ── Selected branch display name ──────────────────────────
  const selectedBranchName =
    selectedDashboardBranch === 'ALL'
      ? 'All Branches'
      : orgSettings?.branches?.find((b: any) => b.id === selectedDashboardBranch)?.name ?? 'All';

  // ── Render ────────────────────────────────────────────────
  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshData(true)}
            colors={['#4F46E5']}
            tintColor="#4F46E5"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Dashboard</Text>
            <Text style={styles.headerSub}>{profile?.companyName ?? 'Overview'}</Text>
          </View>
          <View style={styles.headerActions}>
            {(orgSettings?.branches?.length ?? 0) > 1 && (
              <Pressable
                style={styles.branchPicker}
                onPress={() => setShowBranchModal(true)}
              >
                <Ionicons name="git-branch-outline" size={14} color="#4F46E5" />
                <Text style={styles.branchPickerText} numberOfLines={1}>
                  {selectedBranchName}
                </Text>
                <Ionicons name="chevron-down" size={13} color="#6B7280" />
              </Pressable>
            )}
            <Pressable
              style={styles.refreshBtn}
              onPress={() => refreshData(true)}
            >
              {loading && !refreshing
                ? <ActivityIndicator size={16} color="#4F46E5" />
                : (
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={loading ? '#4F46E5' : '#6B7280'}
                  />
                )}
            </Pressable>
          </View>
        </View>

        {/* ── Kiosk Launch Banner ───────────────────────────── */}
        {/* Tapping this opens the admin-session camera kiosk  */}
        {/* (no pairing code needed — uses logged-in profile)  */}
        {limits?.kioskEnabled !== false ? (
          <Pressable style={styles.kioskBanner} onPress={handleKioskLaunch}>
            <View style={styles.kioskBannerLeft}>
              <View style={styles.kioskIconWrap}>
                <Ionicons name="play-circle-outline" size={26} color="#A5B4FC" />
              </View>
              <View>
                <Text style={styles.kioskBannerTitle}>Launch Attendance Kiosk</Text>
                <Text style={styles.kioskBannerSub}>Scan Faces for Check-In / Out</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#818CF8" />
          </Pressable>
        ) : (
          <View style={styles.kioskLocked}>
            <View style={styles.kioskIconWrap}>
              <Ionicons name="lock-closed-outline" size={22} color="#9CA3AF" />
            </View>
            <View>
              <Text style={styles.kioskLockedTitle}>Face Scan Kiosk (Locked)</Text>
              <Text style={styles.kioskLockedSub}>Upgrade to Pro to unlock AI Attendance</Text>
            </View>
          </View>
        )}

        {/* ── 2×2 Stat Cards ───────────────────────────────── */}
        <View style={styles.statsGrid}>
          <StatCard
            iconName="checkmark-circle-outline"
            value={stats.present + stats.halfDay}
            label="Present"
            subLabel={`${stats.present} Full • ${stats.halfDay} Half`}
            color="#16A34A"
            bg="#DCFCE7"
          />
          <StatCard
            iconName="timer-outline"
            value={stats.pending}
            label="In Progress"
            subLabel="< 4 Hours Worked"
            color="#2563EB"
            bg="#DBEAFE"
          />
          <StatCard
            iconName="time-outline"
            value={stats.late}
            label="Late Arrival"
            subLabel="Impacts Salary"
            color="#EA580C"
            bg="#FFEDD5"
          />
          <StatCard
            iconName="close-circle-outline"
            value={stats.absent}
            label="Absent"
            subLabel={`Total Staff: ${stats.total}`}
            color="#DC2626"
            bg="#FEE2E2"
          />
        </View>

        {/* ── Live Activity ─────────────────────────────────── */}
        <View style={styles.activityCard}>
          <View style={styles.activityHeader}>
            <View style={styles.activityTitleRow}>
              <Ionicons name="pulse-outline" size={15} color="#3B82F6" />
              <Text style={styles.activityTitle}>Live Activity</Text>
            </View>
            <View style={styles.todayBadge}>
              <Text style={styles.todayBadgeText}>Today</Text>
            </View>
          </View>

          {loading && recentActivity.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#4F46E5" />
            </View>
          ) : recentActivity.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="time-outline" size={28} color="#D1D5DB" />
              <Text style={styles.emptyText}>No attendance activity today.</Text>
            </View>
          ) : (
            recentActivity.map((record) => {
              const lastPunch =
                record.timeline?.length > 0
                  ? record.timeline[record.timeline.length - 1]
                  : null;
              const timeStr = lastPunch?.timestamp ?? record.date;
              const isOut = lastPunch?.type === 'OUT';
              const isOutOfZone = lastPunch?.isOutOfGeofence === true;
              const badge = getStatusBadge(record.computedStatus);
              const timeFormatted = new Date(timeStr).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit',
              });
              const initial = (record.workerName ?? '?').charAt(0).toUpperCase();

              return (
                <View key={record.id} style={styles.activityRow}>
                  {/* Avatar */}
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>

                  {/* Info */}
                  <View style={styles.activityInfo}>
                    <View style={styles.activityTopRow}>
                      <Text style={styles.workerName} numberOfLines={1}>
                        {record.workerName}
                      </Text>
                      <Text style={styles.hoursText}>
                        {record.currentHours.toFixed(1)} hrs
                      </Text>
                    </View>
                    <View style={styles.activityBottomRow}>
                      <View style={styles.activityMeta}>
                        <Text style={styles.punchTime}>
                          {isOut ? 'Out' : 'In'} {timeFormatted}
                        </Text>
                        {record.isLate && (
                          <View style={styles.lateBadge}>
                            <Text style={styles.lateBadgeText}>LATE</Text>
                          </View>
                        )}
                        {isOutOfZone && (
                          <View style={styles.zoneBadge}>
                            <Ionicons name="location-outline" size={9} color="#C2410C" />
                            <Text style={styles.zoneBadgeText}>OUT OF ZONE</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: badge.color }]}>
                          {badge.text}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ── Kiosk Branch Select Modal ─────────────────────────── */}
      {/* Shown only when org has multiple branches              */}
      <Modal
        visible={showKioskModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowKioskModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Kiosk Location</Text>
            <Text style={styles.modalSub}>
              Which factory/site is this device at? Only faces for this branch
              will be loaded for best performance.
            </Text>

            <View style={styles.branchList}>
              {orgSettings?.branches?.map((b: any) => {
                const isSelected = selectedKioskBranch === b.id;
                return (
                  <Pressable
                    key={b.id}
                    style={[
                      styles.branchOption,
                      isSelected && styles.branchOptionSelected,
                    ]}
                    onPress={() => setSelectedKioskBranch(b.id)}
                  >
                    <Ionicons
                      name="location-outline"
                      size={16}
                      color={isSelected ? '#4F46E5' : '#9CA3AF'}
                    />
                    <Text
                      style={[
                        styles.branchOptionText,
                        isSelected && styles.branchOptionTextSelected,
                      ]}
                    >
                      {b.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setShowKioskModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.confirmBtn} onPress={handleKioskConfirm}>
                <Text style={styles.confirmBtnText}>Launch Device</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Branch Filter Modal ───────────────────────────────── */}
      <Modal
        visible={showBranchModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBranchModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filter by Branch</Text>
            <View style={styles.branchList}>
              {[
                { id: 'ALL', name: 'All Branches' },
                ...(orgSettings?.branches ?? []),
              ].map((b: any) => {
                const isSelected = selectedDashboardBranch === b.id;
                return (
                  <Pressable
                    key={b.id}
                    style={[
                      styles.branchOption,
                      isSelected && styles.branchOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedDashboardBranch(b.id);
                      setShowBranchModal(false);
                    }}
                  >
                    <Ionicons
                      name="git-branch-outline"
                      size={15}
                      color={isSelected ? '#4F46E5' : '#9CA3AF'}
                    />
                    <Text
                      style={[
                        styles.branchOptionText,
                        isSelected && styles.branchOptionTextSelected,
                      ]}
                    >
                      {b.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setShowBranchModal(false)}
            >
              <Text style={styles.cancelBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 100 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  branchPicker: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
    maxWidth: 140,
  },
  branchPickerText: { fontSize: 12, fontWeight: '600', color: '#374151', flex: 1 },
  refreshBtn: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, padding: 8,
  },

  // Kiosk banner
  kioskBanner: {
    backgroundColor: '#1E1B4B', borderRadius: 16,
    padding: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  kioskBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kioskIconWrap: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, padding: 8,
  },
  kioskBannerTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  kioskBannerSub: { fontSize: 11, color: '#A5B4FC', marginTop: 2 },
  kioskLocked: {
    backgroundColor: '#F3F4F6', borderRadius: 16,
    padding: 16, flexDirection: 'row',
    alignItems: 'center', gap: 12,
    marginBottom: 16,
  },
  kioskLockedTitle: { fontSize: 14, fontWeight: '700', color: '#6B7280' },
  kioskLockedSub: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  // Stats grid
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 10, marginBottom: 16,
  },
  statCard: {
    width: '47.5%', backgroundColor: '#fff',
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOpacity: 0.04,
    shadowRadius: 6, elevation: 2,
  },
  statIconBadge: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10, alignSelf: 'flex-end',
  },
  statValue: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  statLabel: {
    fontSize: 11, fontWeight: '700', color: '#4B5563',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4,
  },
  statSubLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },

  // Activity card
  activityCard: {
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOpacity: 0.04,
    shadowRadius: 6, elevation: 2,
    overflow: 'hidden',
  },
  activityHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  activityTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activityTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  todayBadge: {
    backgroundColor: '#F3F4F6', borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  todayBadgeText: { fontSize: 10, color: '#6B7280', fontWeight: '500' },
  emptyState: { padding: 40, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 12, color: '#9CA3AF' },

  // Activity row
  activityRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, gap: 10,
    borderTopWidth: 1, borderTopColor: '#F9FAFB',
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#EEF2FF', alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderColor: '#E0E7FF',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: '#4F46E5' },
  activityInfo: { flex: 1 },
  activityTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  workerName: { fontSize: 13, fontWeight: '700', color: '#111827', flex: 1 },
  hoursText: {
    fontSize: 12, fontWeight: '600', color: '#6B7280',
    fontVariant: ['tabular-nums'],
  },
  activityBottomRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 3,
  },
  activityMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  punchTime: { fontSize: 10, color: '#9CA3AF' },
  lateBadge: {
    backgroundColor: '#FEE2E2', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  lateBadgeText: { fontSize: 9, fontWeight: '700', color: '#DC2626' },
  zoneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#FFF7ED', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  zoneBadgeText: { fontSize: 9, fontWeight: '700', color: '#C2410C' },
  statusBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  statusBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 6 },
  modalSub: { fontSize: 12, color: '#6B7280', marginBottom: 16 },
  branchList: { gap: 8, marginBottom: 20 },
  branchOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 12,
    borderWidth: 2, borderColor: '#F3F4F6',
  },
  branchOptionSelected: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  branchOptionText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  branchOptionTextSelected: { color: '#4F46E5' },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, padding: 14, backgroundColor: '#F3F4F6',
    borderRadius: 12, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  confirmBtn: {
    flex: 1, padding: 14, backgroundColor: '#4F46E5',
    borderRadius: 12, alignItems: 'center',
  },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
