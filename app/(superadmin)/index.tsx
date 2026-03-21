// app/(superadmin)/index.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  Pressable, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { dbService } from '../../src/services/db';
import { useAuth } from '../../src/contexts/AuthContext';

export default function SuperAdminIndexScreen() {
  const { profile } = useAuth();
  const router      = useRouter();
  const [stats,     setStats]     = useState({ total: 0, active: 0, workers: 0 });
  const [tenants,   setTenants]   = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  const loadData = async () => {
    try {
      const data = await dbService.getAllTenants();
      setTenants(data);
      setStats({
        total:   data.length,
        active:  data.filter(t => t.isActive).length,
        workers: data.reduce((s, t) => s + (t.workerCount || 0), 0),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const planBreakdown = ['FREE','TRIAL','STARTER','PRO','ENTERPRISE'].map(p => ({
    plan: p,
    count: tenants.filter(t => (t.plan || 'FREE') === p).length,
  }));

  const PLAN_COLOR: Record<string, string> = {
    FREE: '#6B7280', TRIAL: '#F59E0B', STARTER: '#3B82F6', PRO: '#8B5CF6', ENTERPRISE: '#10B981',
  };

  if (loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor="#6366F1" />}
    >
      {/* Hero header */}
      <View style={s.hero}>
        <View style={s.heroRow}>
          <View style={s.heroIcon}>
            <Ionicons name="shield-checkmark" size={22} color="#fff" />
          </View>
          <View>
            <Text style={s.heroTitle}>Master Control</Text>
            <Text style={s.heroSub}>WorkforcePro Super Admin</Text>
          </View>
        </View>

        {/* Stat cards */}
        <View style={s.statsGrid}>
          <View style={[s.statCard, { borderLeftColor: '#3B82F6' }]}>
            <Ionicons name="business-outline" size={20} color="#3B82F6" />
            <Text style={s.statNum}>{stats.total}</Text>
            <Text style={s.statLabel}>Organizations</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: '#10B981' }]}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#10B981" />
            <Text style={s.statNum}>{stats.active}</Text>
            <Text style={s.statLabel}>Active Licenses</Text>
          </View>
          <View style={[s.statCard, { borderLeftColor: '#8B5CF6' }]}>
            <Ionicons name="people-outline" size={20} color="#8B5CF6" />
            <Text style={s.statNum}>{stats.workers}</Text>
            <Text style={s.statLabel}>Total Workforce</Text>
          </View>
        </View>
      </View>

      {/* Plan breakdown */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Plan Distribution</Text>
        <View style={s.planGrid}>
          {planBreakdown.map(({ plan, count }) => (
            <View key={plan} style={[s.planCard, { borderTopColor: PLAN_COLOR[plan] }]}>
              <Text style={[s.planCount, { color: PLAN_COLOR[plan] }]}>{count}</Text>
              <Text style={s.planLabel}>{plan}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Quick actions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Quick Actions</Text>
        <View style={s.actionGrid}>
          <Pressable style={s.actionCard} onPress={() => router.push('/(superadmin)/orgs' as any)}>
            <View style={[s.actionIcon, { backgroundColor: '#EEF2FF' }]}>
              <Ionicons name="business-outline" size={20} color="#4F46E5" />
            </View>
            <Text style={s.actionLabel}>Manage Orgs</Text>
            <Text style={s.actionSub}>View & control tenants</Text>
          </Pressable>
          <Pressable style={s.actionCard} onPress={() => router.push('/(superadmin)/plans' as any)}>
            <View style={[s.actionIcon, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="settings-outline" size={20} color="#16A34A" />
            </View>
            <Text style={s.actionLabel}>Plan Limits</Text>
            <Text style={s.actionSub}>Edit global plan config</Text>
          </Pressable>
        </View>
      </View>

      {/* Recent orgs */}
      <View style={s.section}>
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Recent Organizations</Text>
          <Pressable onPress={() => router.push('/(superadmin)/orgs' as any)}>
            <Text style={s.seeAll}>See All →</Text>
          </Pressable>
        </View>
        {tenants.slice(0, 5).map((t) => (
          <View key={t.id} style={s.recentRow}>
            <View style={s.recentAvatar}>
              <Text style={s.recentAvatarTxt}>
                {(t.companyName ?? 'U')[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.recentName} numberOfLines={1}>{t.companyName ?? 'Unnamed'}</Text>
              <Text style={s.recentEmail} numberOfLines={1}>{t.email}</Text>
            </View>
            <View style={[s.planBadge, { backgroundColor: PLAN_COLOR[t.plan ?? 'FREE'] + '22' }]}>
              <Text style={[s.planBadgeTxt, { color: PLAN_COLOR[t.plan ?? 'FREE'] }]}>
                {t.plan ?? 'FREE'}
              </Text>
            </View>
            <View style={[s.statusDot, { backgroundColor: t.isActive ? '#10B981' : '#EF4444' }]} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#F8FAFC' },
  scroll:        { paddingBottom: 40 },
  loader:        { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  hero:          { backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28 },
  heroRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  heroIcon:      { width: 44, height: 44, borderRadius: 12, backgroundColor: '#4F46E5', alignItems: 'center', justifyContent: 'center' },
  heroTitle:     { fontSize: 18, fontWeight: '900', color: '#F1F5F9' },
  heroSub:       { fontSize: 11, color: '#64748B', marginTop: 2 },
  statsGrid:     { flexDirection: 'row', gap: 10 },
  statCard:      { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderLeftWidth: 3, gap: 4 },
  statNum:       { fontSize: 22, fontWeight: '900', color: '#F1F5F9', marginTop: 4 },
  statLabel:     { fontSize: 9, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' },
  section:       { marginHorizontal: 16, marginTop: 20 },
  sectionRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:  { fontSize: 13, fontWeight: '800', color: '#1E293B', marginBottom: 12 },
  seeAll:        { fontSize: 12, fontWeight: '700', color: '#4F46E5' },
  planGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planCard:      { flex: 1, minWidth: 60, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderTopWidth: 3, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  planCount:     { fontSize: 20, fontWeight: '900' },
  planLabel:     { fontSize: 9, fontWeight: '700', color: '#9CA3AF', marginTop: 2, textTransform: 'uppercase' },
  actionGrid:    { flexDirection: 'row', gap: 10 },
  actionCard:    { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  actionIcon:    { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  actionLabel:   { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  actionSub:     { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  recentRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  recentAvatar:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  recentAvatarTxt: { fontSize: 14, fontWeight: '900', color: '#4F46E5' },
  recentName:    { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  recentEmail:   { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  planBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  planBadgeTxt:  { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  statusDot:     { width: 8, height: 8, borderRadius: 4 },
});
