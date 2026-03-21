// app/(superadmin)/orgs.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet, Pressable,
  Modal, ScrollView, Alert, ActivityIndicator, RefreshControl, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dbService } from '../../src/services/db';
import { useAuth } from '../../src/contexts/AuthContext';
import { SubscriptionTier, PlanLimits } from '../../src/types/index';

const PLANS: SubscriptionTier[] = ['FREE','TRIAL','STARTER','PRO','ENTERPRISE'];
const PLAN_COLOR: Record<string, string> = {
  FREE: '#6B7280', TRIAL: '#F59E0B', STARTER: '#3B82F6', PRO: '#8B5CF6', ENTERPRISE: '#10B981',
};

const BOOL_OVERRIDES: { key: keyof PlanLimits; label: string }[] = [
  { key: 'kioskEnabled',               label: 'Kiosk Mode'              },
  { key: 'geofencingEnabled',          label: 'Geofencing'              },
  { key: 'multiBranchEnabled',         label: 'Multi-Branch'            },
  { key: 'livenessDetectionEnabled',   label: 'Face Liveness'           },
  { key: 'advancedLeavesEnabled',      label: 'Advanced Leaves'         },
  { key: 'allowancesAndDeductionsEnabled', label: 'Allowances/Deductions'},
  { key: 'statutoryComplianceEnabled', label: 'PF / ESIC Compliance'    },
  { key: 'bulkImportEnabled',          label: 'Bulk Import'             },
  { key: 'idCardEnabled',              label: 'ID Cards'                },
  { key: 'payslipEnabled',             label: 'Payslips'                },
  { key: 'publicHolidaysEnabled',      label: 'Public Holidays'         },
];

export default function OrgsScreen() {
  const { impersonateTenant } = useAuth();
  const [tenants,     setTenants]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [modal,       setModal]       = useState(false);
  const [selected,    setSelected]    = useState<any>(null);
  const [overrides,   setOverrides]   = useState<Partial<PlanLimits>>({});
  const [saving,      setSaving]      = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await dbService.getAllTenants();
      setTenants(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, []);

  const handlePlanChange = async (tenantId: string, plan: SubscriptionTier) => {
    Alert.alert('Change Plan', `Set plan to ${plan}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm', style: 'destructive',
        onPress: async () => {
          setTenants(prev => prev.map(t => t.tenantId === tenantId ? { ...t, plan } : t));
          await dbService.updateTenantPlan(tenantId, plan);
        },
      },
    ]);
  };

  const handleToggle = async (id: string, current: boolean) => {
    Alert.alert(current ? 'Deactivate?' : 'Activate?', 'Confirm?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes',
        onPress: async () => {
          setTenants(prev => prev.map(t => t.id === id ? { ...t, isActive: !current } : t));
          await dbService.toggleTenantStatus(id, current);
          loadData();
        },
      },
    ]);
  };

  const openOverrides = (tenant: any) => {
    setSelected(tenant);
    setOverrides(tenant.overrides ?? {});
    setModal(true);
  };

  const saveOverrides = async () => {
    if (!selected) return;
    setSaving(true);
    await dbService.updateTenantOverrides(selected.tenantId, overrides);
    setSaving(false);
    setModal(false);
    loadData();
  };

  const handleImpersonate = (tenant: any) => {
    Alert.alert('Impersonate', `View as ${tenant.companyName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: () => impersonateTenant(tenant.tenantId, tenant.companyName) },
    ]);
  };

  const filtered = tenants.filter(t =>
    (t.companyName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (t.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const renderItem = ({ item }: { item: any }) => (
    <View style={c.card}>
      {/* Top row */}
      <View style={c.cardTop}>
        <View style={c.cardAvatar}>
          <Text style={c.cardAvatarTxt}>{(item.companyName ?? 'U')[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={c.cardName} numberOfLines={1}>{item.companyName ?? 'Unnamed'}</Text>
          <Text style={c.cardEmail} numberOfLines={1}>{item.email}</Text>
          <Text style={c.cardId} numberOfLines={1}>ID: {item.tenantId}</Text>
        </View>
        <View style={[c.statusDot, { backgroundColor: item.isActive ? '#10B981' : '#EF4444' }]} />
      </View>

      {/* Stats row */}
      <View style={c.statsRow}>
        <View style={c.stat}>
          <Ionicons name="people-outline" size={13} color="#6B7280" />
          <Text style={c.statTxt}>{item.workerCount} workers</Text>
        </View>
        <View style={c.stat}>
          <Ionicons name="calendar-outline" size={13} color="#6B7280" />
          <Text style={c.statTxt}>{new Date(item.joinedAt).toLocaleDateString('en-IN')}</Text>
        </View>
        {Object.keys(item.overrides ?? {}).length > 0 && (
          <View style={c.overrideBadge}>
            <Text style={c.overrideTxt}>Custom Overrides</Text>
          </View>
        )}
      </View>

      {/* Plan selector */}
      <View style={c.planRow}>
        <Text style={c.planRowLabel}>Plan:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={c.planPills}>
            {PLANS.map(p => (
              <Pressable
                key={p}
                style={[c.planPill, { borderColor: PLAN_COLOR[p] }, (item.plan ?? 'FREE') === p && { backgroundColor: PLAN_COLOR[p] }]}
                onPress={() => handlePlanChange(item.tenantId, p)}
              >
                <Text style={[c.planPillTxt, { color: (item.plan ?? 'FREE') === p ? '#fff' : PLAN_COLOR[p] }]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Actions */}
      <View style={c.actions}>
        <Pressable style={[c.actionBtn, { borderColor: '#E0E7FF' }]} onPress={() => openOverrides(item)}>
          <Ionicons name="options-outline" size={15} color="#4F46E5" />
          <Text style={[c.actionTxt, { color: '#4F46E5' }]}>Overrides</Text>
        </Pressable>
        <Pressable style={[c.actionBtn, { borderColor: '#DBEAFE' }]} onPress={() => handleImpersonate(item)}>
          <Ionicons name="eye-outline" size={15} color="#2563EB" />
          <Text style={[c.actionTxt, { color: '#2563EB' }]}>Impersonate</Text>
        </Pressable>
        <Pressable
          style={[c.actionBtn, { borderColor: item.isActive ? '#FEE2E2' : '#DCFCE7' }]}
          onPress={() => handleToggle(item.id, item.isActive)}
        >
          <Ionicons name={item.isActive ? 'power-outline' : 'checkmark-circle-outline'} size={15} color={item.isActive ? '#EF4444' : '#16A34A'} />
          <Text style={[c.actionTxt, { color: item.isActive ? '#EF4444' : '#16A34A' }]}>
            {item.isActive ? 'Deactivate' : 'Activate'}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={c.root}>
      {/* Search header */}
      <View style={c.header}>
        <Text style={c.headerTitle}>Organizations</Text>
        <Text style={c.headerSub}>{tenants.length} total tenants</Text>
        <View style={c.searchBox}>
          <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            style={c.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={c.loader}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor="#6366F1" />}
          ListEmptyComponent={
            <View style={c.empty}>
              <Ionicons name="business-outline" size={48} color="#D1D5DB" />
              <Text style={c.emptyTxt}>No organizations found</Text>
            </View>
          }
        />
      )}

      {/* Overrides Modal */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={m.backdrop}>
          <View style={m.sheet}>
            {/* Header */}
            <View style={m.mHeader}>
              <Ionicons name="options-outline" size={18} color="#F97316" />
              <Text style={m.mTitle}>Feature Overrides</Text>
              <Pressable onPress={() => setModal(false)} style={m.closeBtn}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>

            <ScrollView style={m.body} showsVerticalScrollIndicator={false}>
              {selected && (
                <View style={m.tenantInfo}>
                  <Text style={m.tenantName}>{selected.companyName}</Text>
                  <View style={[m.planTag, { backgroundColor: PLAN_COLOR[selected.plan ?? 'FREE'] + '22' }]}>
                    <Text style={[m.planTagTxt, { color: PLAN_COLOR[selected.plan ?? 'FREE'] }]}>
                      {selected.plan ?? 'FREE'} plan
                    </Text>
                  </View>
                  <Text style={m.warning}>
                    These override the default {selected.plan} plan limits for this tenant only.
                  </Text>
                </View>
              )}

              {/* Max Workers input */}
              <View style={m.fieldGroup}>
                <Text style={m.fieldLabel}>Max Workers Override</Text>
                <TextInput
                  style={m.input}
                  keyboardType="numeric"
                  placeholder="Leave blank to use plan default"
                  placeholderTextColor="#9CA3AF"
                  value={overrides.maxWorkers != null ? String(overrides.maxWorkers) : ''}
                  onChangeText={v => setOverrides({ ...overrides, maxWorkers: v ? parseInt(v) : undefined })}
                />
              </View>

              {/* Boolean toggles */}
              <Text style={m.togglesLabel}>Feature Toggles</Text>
              {BOOL_OVERRIDES.map(({ key, label }) => (
                <View key={key} style={m.toggleRow}>
                  <Text style={m.toggleLabel}>{label}</Text>
                  <Switch
                    value={!!(overrides as any)[key]}
                    onValueChange={v => setOverrides({ ...overrides, [key]: v })}
                    trackColor={{ false: '#E5E7EB', true: '#A5B4FC' }}
                    thumbColor={!!(overrides as any)[key] ? '#4F46E5' : '#9CA3AF'}
                  />
                </View>
              ))}
            </ScrollView>

            {/* Footer */}
            <View style={m.mFooter}>
              <Pressable style={m.cancelBtn} onPress={() => setModal(false)}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </Pressable>
              <Pressable style={m.saveBtn} onPress={saveOverrides} disabled={saving}>
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={m.saveTxt}>Save Overrides</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Card styles
const c = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#F8FAFC' },
  header:        { backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  headerTitle:   { fontSize: 18, fontWeight: '900', color: '#F1F5F9' },
  headerSub:     { fontSize: 11, color: '#64748B', marginTop: 2, marginBottom: 14 },
  searchBox:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  searchInput:   { flex: 1, fontSize: 13, color: '#F1F5F9' },
  loader:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card:          { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  cardAvatar:    { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  cardAvatarTxt: { fontSize: 16, fontWeight: '900', color: '#4F46E5' },
  cardName:      { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  cardEmail:     { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  cardId:        { fontSize: 9, color: '#CBD5E1', marginTop: 2, fontFamily: 'monospace' },
  statusDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  statsRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  stat:          { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statTxt:       { fontSize: 11, color: '#6B7280' },
  overrideBadge: { backgroundColor: '#FFF7ED', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#FED7AA' },
  overrideTxt:   { fontSize: 9, fontWeight: '800', color: '#EA580C', textTransform: 'uppercase' },
  planRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  planRowLabel:  { fontSize: 11, fontWeight: '700', color: '#6B7280' },
  planPills:     { flexDirection: 'row', gap: 6 },
  planPill:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5 },
  planPillTxt:   { fontSize: 10, fontWeight: '800' },
  actions:       { flexDirection: 'row', gap: 8 },
  actionBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8, borderWidth: 1, backgroundColor: '#FAFAFA' },
  actionTxt:     { fontSize: 11, fontWeight: '700' },
  empty:         { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTxt:      { fontSize: 14, color: '#9CA3AF', fontWeight: '600' },
});

// Modal styles
const m = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  mHeader:     { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  mTitle:      { flex: 1, fontSize: 16, fontWeight: '800', color: '#1E293B' },
  closeBtn:    { padding: 4 },
  body:        { paddingHorizontal: 16, paddingTop: 16 },
  tenantInfo:  { marginBottom: 16 },
  tenantName:  { fontSize: 15, fontWeight: '800', color: '#1E293B', marginBottom: 6 },
  planTag:     { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  planTagTxt:  { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  warning:     { fontSize: 11, color: '#92400E', backgroundColor: '#FFF7ED', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FED7AA' },
  fieldGroup:  { marginBottom: 16 },
  fieldLabel:  { fontSize: 11, fontWeight: '700', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:       { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#1E293B' },
  togglesLabel:{ fontSize: 11, fontWeight: '700', color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  mFooter:     { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  cancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' },
  cancelTxt:   { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  saveBtn:     { flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: '#4F46E5', alignItems: 'center' },
  saveTxt:     { fontSize: 13, fontWeight: '800', color: '#fff' },
});
