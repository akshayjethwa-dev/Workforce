// app/(superadmin)/plans.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Switch,
  Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dbService } from '../../src/services/db';
import { SubscriptionTier, PlanLimits, DEFAULT_PLAN_CONFIG } from '../../src/types/index';

const PLANS: SubscriptionTier[] = ['FREE','TRIAL','STARTER','PRO','ENTERPRISE'];
const PLAN_COLOR: Record<string, string> = {
  FREE: '#6B7280', TRIAL: '#F59E0B', STARTER: '#3B82F6', PRO: '#8B5CF6', ENTERPRISE: '#10B981',
};

const BOOL_FIELDS: { key: keyof PlanLimits; label: string; group: string }[] = [
  { key: 'kioskEnabled',                  label: 'Kiosk Mode',                group: 'Core'     },
  { key: 'geofencingEnabled',             label: 'Geofencing',                group: 'Core'     },
  { key: 'multiBranchEnabled',            label: 'Multi-Branch Setup',        group: 'Core'     },
  { key: 'livenessDetectionEnabled',      label: 'Face Liveness Detection',   group: 'Core'     },
  { key: 'advancedLeavesEnabled',         label: 'Advanced Leaves (CL/SL/PL)',group: 'Advanced' },
  { key: 'allowancesAndDeductionsEnabled',label: 'Allowances & Deductions',   group: 'Advanced' },
  { key: 'statutoryComplianceEnabled',    label: 'PF / ESIC Compliance',      group: 'Advanced' },
  { key: 'bulkImportEnabled',             label: 'Bulk Excel Import',         group: 'Advanced' },
  { key: 'idCardEnabled',                 label: 'Digital ID Cards',          group: 'Advanced' },
  { key: 'payslipEnabled',               label: 'Payslip Generation',        group: 'Advanced' },
  { key: 'regulatePunchEnabled',          label: 'Regulate Punch',           group: 'Advanced' },
  { key: 'publicHolidaysEnabled',         label: 'Public Holidays',           group: 'Advanced' },
];

export default function PlansScreen() {
  const [plans,   setPlans]   = useState<Record<SubscriptionTier, PlanLimits> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [expanded,setExpanded]= useState<SubscriptionTier>('STARTER');

  useEffect(() => {
    dbService.getGlobalPlanConfig().then(data => {
      setPlans(data as Record<SubscriptionTier, PlanLimits>);
      setLoading(false);
    });
  }, []);

  const edit = (tier: SubscriptionTier, field: keyof PlanLimits, value: any) => {
    if (!plans) return;
    setPlans({ ...plans, [tier]: { ...plans[tier], [field]: value } });
  };

  const save = async () => {
    if (!plans) return;
    setSaving(true);
    try {
      await dbService.updateGlobalPlanConfig(plans);
      Alert.alert('✅ Saved', 'Global plan limits updated successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = (tier: SubscriptionTier) => {
    Alert.alert('Reset to Default', `Reset ${tier} plan to factory defaults?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => {
        if (!plans) return;
        setPlans({ ...plans, [tier]: DEFAULT_PLAN_CONFIG[tier] });
      }},
    ]);
  };

  if (loading) {
    return <View style={p.loader}><ActivityIndicator size="large" color="#6366F1" /></View>;
  }

  if (!plans) return null;

  const coreFields   = BOOL_FIELDS.filter(f => f.group === 'Core');
  const advFields    = BOOL_FIELDS.filter(f => f.group === 'Advanced');

  return (
    <View style={p.root}>
      {/* Dark header */}
      <View style={p.header}>
        <View style={p.headerTop}>
          <View>
            <Text style={p.headerTitle}>Plan Limits Editor</Text>
            <Text style={p.headerSub}>Changes affect all users on these plans instantly</Text>
          </View>
          <Pressable style={[p.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Ionicons name="save-outline" size={15} color="#fff" />
                  <Text style={p.saveTxt}>Save All</Text>
                </>
            }
          </Pressable>
        </View>
      </View>

      <ScrollView style={p.scroll} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {PLANS.map(tier => {
          const isOpen = expanded === tier;
          const data   = plans[tier];
          return (
            <View key={tier} style={p.planCard}>
              {/* Plan header toggle */}
              <Pressable style={p.planHeader} onPress={() => setExpanded(isOpen ? ('' as any) : tier)}>
                <View style={[p.planDot, { backgroundColor: PLAN_COLOR[tier] }]} />
                <Text style={p.planName}>{tier}</Text>
                <View style={p.planMeta}>
                  <Text style={p.planMetaTxt}>{data.maxWorkers} workers · {data.maxShifts} shifts</Text>
                </View>
                <Pressable style={p.resetBtn} onPress={() => reset(tier)}>
                  <Ionicons name="refresh-outline" size={13} color="#9CA3AF" />
                </Pressable>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
              </Pressable>

              {isOpen && (
                <View style={p.planBody}>
                  {/* Numeric limits */}
                  <Text style={p.groupLabel}>Capacity Limits</Text>
                  <View style={p.numRow}>
                    {([
                      { key: 'maxWorkers',  label: 'Max Workers'  },
                      { key: 'maxManagers', label: 'Max Managers' },
                      { key: 'maxShifts',   label: 'Max Shifts'   },
                    ] as const).map(({ key, label }) => (
                      <View key={key} style={p.numField}>
                        <Text style={p.numLabel}>{label}</Text>
                        <TextInput
                          style={p.numInput}
                          keyboardType="numeric"
                          value={String(data[key])}
                          onChangeText={v => edit(tier, key, parseInt(v) || 0)}
                        />
                      </View>
                    ))}
                  </View>

                  {/* Core feature toggles */}
                  <Text style={p.groupLabel}>Core Features</Text>
                  {coreFields.map(({ key, label }) => (
                    <View key={key} style={p.toggleRow}>
                      <Text style={p.toggleLabel}>{label}</Text>
                      <Switch
                        value={!!(data as any)[key]}
                        onValueChange={v => edit(tier, key, v)}
                        trackColor={{ false: '#E5E7EB', true: '#A5B4FC' }}
                        thumbColor={!!(data as any)[key] ? '#4F46E5' : '#9CA3AF'}
                      />
                    </View>
                  ))}

                  {/* Advanced toggles */}
                  <Text style={p.groupLabel}>Advanced Modules</Text>
                  {advFields.map(({ key, label }) => (
                    <View key={key} style={p.toggleRow}>
                      <Text style={p.toggleLabel}>{label}</Text>
                      <Switch
                        value={!!(data as any)[key]}
                        onValueChange={v => edit(tier, key, v)}
                        trackColor={{ false: '#E5E7EB', true: '#A5B4FC' }}
                        thumbColor={!!(data as any)[key] ? '#4F46E5' : '#9CA3AF'}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const p = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#F8FAFC' },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:      { backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  headerTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#F1F5F9' },
  headerSub:   { fontSize: 11, color: '#64748B', marginTop: 3 },
  saveBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#4F46E5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  saveTxt:     { fontSize: 13, fontWeight: '800', color: '#fff' },
  scroll:      { flex: 1 },
  planCard:    { backgroundColor: '#fff', borderRadius: 16, marginBottom: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  planHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  planDot:     { width: 10, height: 10, borderRadius: 5 },
  planName:    { fontSize: 14, fontWeight: '900', color: '#1E293B', flex: 1 },
  planMeta:    { backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  planMetaTxt: { fontSize: 10, fontWeight: '700', color: '#64748B' },
  resetBtn:    { padding: 6, backgroundColor: '#F9FAFB', borderRadius: 6, marginRight: 2 },
  planBody:    { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  groupLabel:  { fontSize: 10, fontWeight: '800', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 10 },
  numRow:      { flexDirection: 'row', gap: 10, marginBottom: 4 },
  numField:    { flex: 1 },
  numLabel:    { fontSize: 10, fontWeight: '700', color: '#6B7280', marginBottom: 4 },
  numInput:    { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontWeight: '800', color: '#1E293B', textAlign: 'center' },
  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: '#374151', flex: 1 },
});
