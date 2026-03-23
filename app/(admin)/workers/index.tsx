// app/(admin)/workers/index.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable,
  StyleSheet, RefreshControl, Modal, ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import { wageService } from '../../../src/services/wageService';
import { Worker, OrgSettings } from '../../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Worker Card  (React.memo for FlatList perf)
// ─────────────────────────────────────────────────────────────
interface WorkerCardProps {
  worker: Worker;
  settings: OrgSettings | null;
  canDelete: boolean;
  advanceEnabled: boolean;
  onEdit: (w: Worker) => void;
  onDelete: (w: Worker) => void;
  onAdvance: (w: Worker) => void;
}

const WorkerCard = React.memo(
  ({ worker, canDelete, advanceEnabled, onEdit, onDelete, onAdvance }: WorkerCardProps) => {
    const isActive = worker.status === 'ACTIVE';
    const initial = (worker.name ?? '?').charAt(0).toUpperCase();

    const isMonthly = worker.wageConfig?.type === 'MONTHLY';
    const wageAmount = worker.wageConfig?.amount ?? 0;
    const wageLabel = isMonthly
      ? `₹${wageAmount.toLocaleString()} / month`
      : `₹${wageAmount.toLocaleString()} / day`;

    return (
      <View style={cardStyles.card}>
        {/* Top row */}
        <View style={cardStyles.topRow}>
          {/* Avatar */}
          <View style={cardStyles.avatar}>
            <Text style={cardStyles.avatarText}>{initial}</Text>
          </View>

          {/* Info */}
          <View style={cardStyles.info}>
            <Text style={cardStyles.name} numberOfLines={1}>{worker.name}</Text>
            <View style={cardStyles.tagsRow}>
              {!!worker.designation && (
                <View style={cardStyles.tag}>
                  <Text style={cardStyles.tagText}>{worker.designation}</Text>
                </View>
              )}
              {!!worker.department && (
                <View style={[cardStyles.tag, cardStyles.tagPurple]}>
                  <Text style={[cardStyles.tagText, { color: '#7C3AED' }]}>{worker.department}</Text>
                </View>
              )}
              {!!worker.branchId && (
                <View style={[cardStyles.tag, cardStyles.tagGray]}>
                  <Text style={[cardStyles.tagText, { color: '#6B7280' }]}>{worker.branchId}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Right: status + actions */}
          <View style={cardStyles.rightCol}>
            <View style={[cardStyles.statusBadge, isActive ? cardStyles.activeBadge : cardStyles.inactiveBadge]}>
              <Text style={[cardStyles.statusText, { color: isActive ? '#15803D' : '#6B7280' }]}>
                {isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
            <View style={cardStyles.actions}>
              <Pressable style={cardStyles.iconBtn} onPress={() => onEdit(worker)}>
                <Ionicons name="create-outline" size={18} color="#4F46E5" />
              </Pressable>
              {canDelete && (
                <Pressable style={[cardStyles.iconBtn, cardStyles.iconBtnRed]} onPress={() => onDelete(worker)}>
                  <Ionicons name="trash-outline" size={16} color="#DC2626" />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Divider + wage + advance */}
        <View style={cardStyles.bottomRow}>
          <View style={cardStyles.wageChip}>
            <Ionicons name="cash-outline" size={13} color="#6B7280" />
            <Text style={cardStyles.wageText}>{wageLabel}</Text>
          </View>
          <Pressable
            style={[cardStyles.advanceBtn, !advanceEnabled && cardStyles.advanceBtnLocked]}
            onPress={() => onAdvance(worker)}
          >
            <Ionicons
              name={advanceEnabled ? 'wallet-outline' : 'lock-closed-outline'}
              size={13}
              color={advanceEnabled ? '#15803D' : '#9CA3AF'}
            />
            <Text style={[cardStyles.advanceBtnText, !advanceEnabled && { color: '#9CA3AF' }]}>
              {advanceEnabled ? 'Give Advance' : 'Advance (Pro)'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
);

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
type FilterType = 'ALL' | 'ACTIVE' | 'INACTIVE';

export default function WorkersScreen() {
  const router = useRouter();
  const { profile, limits } = useAuth();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Delete modal
  const [workerToDelete, setWorkerToDelete] = useState<Worker | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Advance modal
  const [advanceModal, setAdvanceModal] = useState({
    isOpen: false,
    worker: null as Worker | null,
    amount: '',
    date: new Date().toISOString().split('T')[0],
    reason: 'Kharchi',
    earned: 0,
    existingAdvances: 0,
    isSaving: false,
  });

  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async (isManual = false) => {
    if (!profile?.tenantId) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const [workersData, settingsData] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getOrgSettings(profile.tenantId),
      ]);
      setWorkers(workersData as Worker[]);
      setSettings(settingsData as OrgSettings);
    } catch (e) {
      console.error('Failed to load workers:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered list (memoized) ────────────────────────────────
  const filteredWorkers = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return workers.filter((w) => {
      const matchSearch =
        w.name?.toLowerCase().includes(q) ||
        w.phone?.includes(searchTerm);
      const matchFilter =
        filter === 'ALL' ||
        (filter === 'ACTIVE' && w.status === 'ACTIVE') ||
        (filter === 'INACTIVE' && w.status !== 'ACTIVE');
      return matchSearch && matchFilter;
    });
  }, [workers, searchTerm, filter]);

  // ── Add worker guard ────────────────────────────────────────
  const handleAddWorker = () => {
    if (limits && workers.length >= limits.maxWorkers) {
      Alert.alert(
        'Plan Limit Reached',
        `Your plan allows up to ${limits.maxWorkers} workers. Upgrade to add more.`,
        [{ text: 'OK' }]
      );
      return;
    }
    router.push('/(admin)/workers/add' as any);
  };

  // ── Edit ────────────────────────────────────────────────────
  const handleEdit = (worker: Worker) => {
    router.push({ pathname: '/(admin)/workers/add' as any, params: { workerId: worker.id } });
  };

  // ── Delete ──────────────────────────────────────────────────
  const handleDeleteRequest = (worker: Worker) => setWorkerToDelete(worker);

  const confirmDelete = async () => {
    if (!workerToDelete || !profile?.tenantId) return;
    setIsDeleting(true);
    try {
      await dbService.deleteWorker(profile.tenantId, workerToDelete.id);
      setWorkers((prev) => prev.filter((w) => w.id !== workerToDelete.id));
      setWorkerToDelete(null);
    } catch (e) {
      console.error('Deletion failed:', e);
      Alert.alert('Error', 'Failed to delete worker. Check your connection.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Advance ─────────────────────────────────────────────────
  const handleOpenAdvance = async (worker: Worker) => {
    if (!limits?.allowancesAndDeductionsEnabled) {
      Alert.alert('Pro Feature', 'Advance/Kharchi tracking requires a Pro plan.');
      return;
    }
    const currentMonth = new Date().toISOString().slice(0, 7);
    const [attendance, advances] = await Promise.all([
      dbService.getAttendanceHistory(profile!.tenantId!),
      dbService.getAdvances(profile!.tenantId!),
    ]);
    const earned = wageService.calculateCurrentEarnings(worker, currentMonth, attendance, settings!);
    const existingAdvances = (advances as any[])
      .filter((a) => a.workerId === worker.id && a.date.startsWith(currentMonth))
      .reduce((sum: number, a: any) => sum + a.amount, 0);

    setAdvanceModal({
      isOpen: true, worker, amount: '',
      date: new Date().toISOString().split('T')[0],
      reason: 'Kharchi', earned, existingAdvances, isSaving: false,
    });
  };

  const handleSaveAdvance = async () => {
    if (!profile?.tenantId || !advanceModal.worker || !advanceModal.amount) return;
    setAdvanceModal((prev) => ({ ...prev, isSaving: true }));
    try {
      await dbService.addAdvance({
        tenantId: profile.tenantId,
        workerId: advanceModal.worker.id,
        amount: parseFloat(advanceModal.amount),
        date: advanceModal.date,
        reason: advanceModal.reason || 'Kharchi',
        status: 'APPROVED',
      });
      setAdvanceModal((prev) => ({ ...prev, isOpen: false, isSaving: false }));
    } catch (e) {
      Alert.alert('Error', 'Failed to save advance.');
      setAdvanceModal((prev) => ({ ...prev, isSaving: false }));
    }
  };

  const willOverBorrow =
    (Number(advanceModal.amount || 0) + advanceModal.existingAdvances) > advanceModal.earned;

  const canDelete = profile?.role === 'FACTORY_OWNER';
  const advanceEnabled = !!limits?.allowancesAndDeductionsEnabled;

  // ── Render item ─────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Worker }) => (
      <WorkerCard
        worker={item}
        settings={settings}
        canDelete={canDelete}
        advanceEnabled={advanceEnabled}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
        onAdvance={handleOpenAdvance}
      />
    ),
    [settings, canDelete, advanceEnabled]
  );

  // ── Empty state ─────────────────────────────────────────────
  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={48} color="#D1D5DB" />
        <Text style={styles.emptyTitle}>
          {searchTerm || filter !== 'ALL' ? 'No workers found' : 'No workers yet'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {searchTerm || filter !== 'ALL'
            ? 'Try a different search or filter.'
            : 'Tap + to add your first worker.'}
        </Text>
      </View>
    );
  };

  // ── Header (search + filter) ────────────────────────────────
  const ListHeader = (
    <View style={styles.listHeader}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or phone..."
          placeholderTextColor="#9CA3AF"
          value={searchTerm}
          onChangeText={setSearchTerm}
          returnKeyType="search"
        />
        {!!searchTerm && (
          <Pressable onPress={() => setSearchTerm('')}>
            <Ionicons name="close-circle" size={16} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      {/* Filter pills */}
      <View style={styles.filterRow}>
        {(['ALL', 'ACTIVE', 'INACTIVE'] as FilterType[]).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
              {f === 'ALL' ? `All (${workers.length})` : f === 'ACTIVE'
                ? `Active (${workers.filter((w) => w.status === 'ACTIVE').length})`
                : `Inactive (${workers.filter((w) => w.status !== 'ACTIVE').length})`}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // ── Main Render ─────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Page title */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Workers</Text>
        <Text style={styles.headerSub}>{workers.length} total staff</Text>
      </View>

      {loading && workers.length === 0 ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      ) : (
        <FlatList
          // THE FIX: We force the component to remount cleanly with numColumns set to 0 instead of 1 
          // or omitting it. By removing the explicit height on the separator, we avoid CSS-interop attempting to wrap it.
          key={"single-col"} 
          data={filteredWorkers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={['#4F46E5']}
              tintColor="#4F46E5"
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />} 
          removeClippedSubviews={false} // Disable on web to prevent layout bugs
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      {/* FAB — Add Worker */}
      <Pressable style={styles.fab} onPress={handleAddWorker}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      {/* ── Delete Confirm Modal ── */}
      <Modal
        visible={!!workerToDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setWorkerToDelete(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={[styles.modalHeader, { backgroundColor: '#FEF2F2' }]}>
              <View style={styles.modalHeaderLeft}>
                <Ionicons name="warning-outline" size={20} color="#DC2626" />
                <Text style={[styles.modalHeaderTitle, { color: '#DC2626' }]}>Remove Worker</Text>
              </View>
              <Pressable onPress={() => setWorkerToDelete(null)}>
                <Ionicons name="close" size={20} color="#DC2626" />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.deleteConfirmText}>
                Are you sure you want to remove{' '}
                <Text style={{ fontWeight: '800' }}>{workerToDelete?.name}</Text>?
              </Text>
              <View style={styles.warningBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#B45309" style={{ marginTop: 1 }} />
                <Text style={styles.warningText}>
                  This is permanent and will delete their attendance history, advance payments, and payroll records.
                </Text>
              </View>
              <View style={styles.modalActions}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => setWorkerToDelete(null)}
                  disabled={isDeleting}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.deleteBtn, isDeleting && { opacity: 0.6 }]}
                  onPress={confirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.deleteBtnText}>Yes, Remove</Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Advance Modal ── */}
      <Modal
        visible={advanceModal.isOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAdvanceModal((p) => ({ ...p, isOpen: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalHeader, { backgroundColor: '#F0FDF4' }]}>
              <View style={styles.modalHeaderLeft}>
                <Ionicons name="wallet-outline" size={20} color="#15803D" />
                <Text style={[styles.modalHeaderTitle, { color: '#15803D' }]}>Give Advance</Text>
              </View>
              <Pressable onPress={() => setAdvanceModal((p) => ({ ...p, isOpen: false }))}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              {/* Earned / taken summary */}
              <View style={styles.advanceSummary}>
                <Text style={styles.advanceSummaryText}>
                  Earned: <Text style={styles.advanceSummaryBold}>₹{advanceModal.earned.toLocaleString()}</Text>
                </Text>
                <Text style={styles.advanceSummaryText}>
                  Taken: <Text style={[styles.advanceSummaryBold, { color: '#DC2626' }]}>₹{advanceModal.existingAdvances.toLocaleString()}</Text>
                </Text>
              </View>

              {/* Amount */}
              <Text style={styles.fieldLabel}>Amount (₹)</Text>
              <TextInput
                style={styles.fieldInput}
                keyboardType="numeric"
                placeholder="e.g. 500"
                placeholderTextColor="#9CA3AF"
                value={advanceModal.amount}
                onChangeText={(v) => setAdvanceModal((p) => ({ ...p, amount: v }))}
              />

              {/* Overborrow warning */}
              {willOverBorrow && !!advanceModal.amount && (
                <View style={styles.overborrowBox}>
                  <Ionicons name="alert-circle-outline" size={15} color="#B45309" />
                  <Text style={styles.overborrowText}>
                    Total advance will exceed earned wages. Proceed with caution.
                  </Text>
                </View>
              )}

              {/* Date + Note */}
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={advanceModal.date}
                    onChangeText={(v) => setAdvanceModal((p) => ({ ...p, date: v }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Note</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={advanceModal.reason}
                    onChangeText={(v) => setAdvanceModal((p) => ({ ...p, reason: v }))}
                    placeholder="e.g. Medical"
                    placeholderTextColor="#9CA3AF"
                  />
                </View>
              </View>

              <Pressable
                style={[styles.saveAdvanceBtn, (!advanceModal.amount || advanceModal.isSaving) && { opacity: 0.5 }]}
                onPress={handleSaveAdvance}
                disabled={!advanceModal.amount || advanceModal.isSaving}
              >
                {advanceModal.isSaving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="save-outline" size={16} color="#fff" />
                      <Text style={styles.saveAdvanceBtnText}>Save Advance</Text>
                    </View>
                  )
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Card Styles (separate for React.memo component)
// ─────────────────────────────────────────────────────────────
const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 10,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E0E7FF',
  },
  avatarText: { fontSize: 16, fontWeight: '800', color: '#4F46E5' },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: '#111827' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    backgroundColor: '#EFF6FF', borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  tagPurple: { backgroundColor: '#F5F3FF' },
  tagGray: { backgroundColor: '#F9FAFB' },
  tagText: { fontSize: 10, fontWeight: '600', color: '#2563EB' },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  statusBadge: {
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadge: { backgroundColor: '#DCFCE7' },
  inactiveBadge: { backgroundColor: '#F3F4F6' },
  statusText: { fontSize: 10, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    padding: 7, borderRadius: 8,
    backgroundColor: '#EEF2FF',
  },
  iconBtnRed: { backgroundColor: '#FEF2F2' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#F9FAFB',
    gap: 8,
  },
  wageChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F9FAFB', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  wageText: { fontSize: 11, fontWeight: '600', color: '#374151' },
  advanceBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F0FDF4', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  advanceBtnLocked: {
    backgroundColor: '#F9FAFB', borderColor: '#E5E7EB',
  },
  advanceBtnText: {
    fontSize: 11, fontWeight: '700', color: '#15803D',
  },
});

// ─────────────────────────────────────────────────────────────
// Screen Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  headerSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  loadingState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  listHeader: { paddingBottom: 12 },
  
  // FIX: Replaced inline style block for separator
  separator: { height: 10 }, 

  // Search
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 12,
    marginBottom: 10, marginTop: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, fontSize: 14, color: '#111827',
    paddingVertical: 11,
  },

  // Filter pills
  filterRow: { flexDirection: 'row', gap: 8 },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  filterPillActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  filterPillText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  filterPillTextActive: { color: '#fff' },

  // Empty
  emptyState: {
    alignItems: 'center', paddingTop: 60, gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#6B7280' },
  emptySubtitle: { fontSize: 12, color: '#9CA3AF', textAlign: 'center' },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#4F46E5',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4F46E5', shadowOpacity: 0.4,
    shadowRadius: 10, elevation: 6,
  },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalHeaderTitle: { fontSize: 15, fontWeight: '700' },
  modalBody: { padding: 20 },

  // Delete modal
  deleteConfirmText: {
    fontSize: 14, color: '#374151', textAlign: 'center', marginBottom: 14,
  },
  warningBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: 10,
    borderWidth: 1, borderColor: '#FDE68A',
    padding: 12, marginBottom: 20,
  },
  warningText: { fontSize: 12, color: '#92400E', flex: 1, lineHeight: 17 },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, padding: 14, backgroundColor: '#F3F4F6',
    borderRadius: 12, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  deleteBtn: {
    flex: 1, padding: 14, backgroundColor: '#DC2626',
    borderRadius: 12, alignItems: 'center',
  },
  deleteBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Advance modal
  advanceSummary: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#F9FAFB', borderRadius: 10,
    padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  advanceSummaryText: { fontSize: 12, color: '#6B7280' },
  advanceSummaryBold: { fontWeight: '700', color: '#111827' },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#374151',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5,
  },
  fieldInput: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, padding: 12, fontSize: 14,
    color: '#111827', fontWeight: '600', marginBottom: 12,
  },
  overborrowBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#FFFBEB', borderRadius: 10,
    borderWidth: 1, borderColor: '#FDE68A',
    padding: 10, marginBottom: 10,
  },
  overborrowText: { fontSize: 12, color: '#92400E', flex: 1 },
  twoCol: { flexDirection: 'row', gap: 10 },
  saveAdvanceBtn: {
    backgroundColor: '#15803D', borderRadius: 12,
    padding: 14, alignItems: 'center', marginTop: 4,
    marginBottom: 8,
  },
  saveAdvanceBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});