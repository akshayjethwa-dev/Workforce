// app/(superadmin)/_layout.tsx
import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';

const ACTIVE   = '#818CF8';
const INACTIVE = '#64748B';

const SA_NAV = [
  { label: 'Dashboard',   icon: 'shield-checkmark-outline', route: '/(superadmin)/'     },
  { label: 'Orgs',        icon: 'business-outline',         route: '/(superadmin)/orgs'  },
  { label: 'Plan Limits', icon: 'settings-outline',         route: '/(superadmin)/plans' },
] as const;

// ─────────────────────────────────────────────────────────────
// Desktop Sidebar
// ─────────────────────────────────────────────────────────────
function SuperAdminSidebar() {
  const { profile, logout } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  return (
    <View style={sb.root}>
      {/* Header */}
      <View style={sb.header}>
        <View style={sb.logoBox}>
          <Ionicons name="shield-checkmark" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sb.brandName}>Super Admin</Text>
          <Text style={sb.brandSub}>Master Control</Text>
        </View>
      </View>

      {/* Profile chip */}
      <View style={sb.profileRow}>
        <View style={sb.avatar}>
          <Text style={sb.avatarTxt}>
            {(profile?.email ?? 'SA')[0].toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sb.profileName} numberOfLines={1}>
            {(profile as any)?.name ?? 'Super Admin'}
          </Text>
          <Text style={sb.profileEmail} numberOfLines={1}>{profile?.email}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={sb.nav}>
          {SA_NAV.map((item) => {
            const isActive = pathname === item.route || pathname.startsWith(item.route + '/');
            return (
              <Pressable
                key={item.route}
                style={[sb.navItem, isActive && sb.navItemActive]}
                onPress={() => router.push(item.route as any)}
              >
                <View style={[sb.navIcon, isActive && sb.navIconActive]}>
                  <Ionicons name={item.icon as any} size={17} color={isActive ? '#fff' : INACTIVE} />
                </View>
                <Text style={[sb.navLabel, isActive && sb.navLabelActive]}>{item.label}</Text>
                {isActive && <View style={sb.dot} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Back to admin + logout */}
      <View style={sb.footer}>
        <Pressable style={sb.backBtn} onPress={() => router.replace('/(admin)/dashboard' as any)}>
          <Ionicons name="arrow-back-outline" size={15} color="#94A3B8" />
          <Text style={sb.backTxt}>Back to Admin</Text>
        </Pressable>
        <Pressable style={sb.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={15} color="#EF4444" />
          <Text style={sb.logoutTxt}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared tab screens
// ─────────────────────────────────────────────────────────────
const TAB_SCREENS = (
  <>
    <Tabs.Screen
      name="index"
      options={{
        title: 'Dashboard',
        tabBarIcon: ({ color }) => <Ionicons name="shield-checkmark-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="orgs"
      options={{
        title: 'Orgs',
        tabBarIcon: ({ color }) => <Ionicons name="business-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="plans"
      options={{
        title: 'Plans',
        tabBarIcon: ({ color }) => <Ionicons name="settings-outline" size={22} color={color} />,
      }}
    />
  </>
);

// ─────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────
export default function SuperAdminLayout() {
  const { user, profile, loading } = useAuth();
  const router     = useRouter();
  const { width }  = useWindowDimensions();
  const isDesktop  = width >= 1024;

  useEffect(() => {
    if (loading) return;
    if (!user || profile?.role !== 'SUPER_ADMIN') {
      router.replace('/(admin)/dashboard' as any);
    }
  }, [user, profile, loading]);

  if (loading) {
    return (
      <View style={lay.loader}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  if (!user || profile?.role !== 'SUPER_ADMIN') return null;

  // ── Desktop: sidebar + hidden tab bar ──
  if (isDesktop) {
    return (
      <View style={lay.desktopRoot}>
        <SuperAdminSidebar />
        <View style={lay.content}>
          <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
            {TAB_SCREENS}
          </Tabs>
        </View>
      </View>
    );
  }

  // ── Mobile: dark bottom tabs ──
  // ✅ No duplicate keys — activeTintColor and inactiveTintColor appear exactly once
  return (
    <Tabs
      screenOptions={{
        headerShown:             false,
        tabBarActiveTintColor:   ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#0F172A',
          borderTopColor:  '#1E293B',
          borderTopWidth:  1,
          height:          62,
          paddingBottom:   10,
          paddingTop:      4,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      {TAB_SCREENS}
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar styles
// ─────────────────────────────────────────────────────────────
const sb = StyleSheet.create({
  root:          { width: 220, backgroundColor: '#0F172A', paddingBottom: 12 },
  header:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  logoBox:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#4F46E5', alignItems: 'center', justifyContent: 'center' },
  brandName:     { fontSize: 13, fontWeight: '900', color: '#F1F5F9' },
  brandSub:      { fontSize: 10, color: '#64748B', marginTop: 1 },
  profileRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  avatar:        { width: 32, height: 32, borderRadius: 16, backgroundColor: '#312E81', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:     { fontSize: 13, fontWeight: '900', color: '#A5B4FC' },
  profileName:   { fontSize: 12, fontWeight: '700', color: '#E2E8F0' },
  profileEmail:  { fontSize: 10, color: '#64748B', marginTop: 1 },
  nav:           { paddingHorizontal: 10, paddingTop: 10, gap: 2 },
  navItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10 },
  navItemActive: { backgroundColor: '#1E293B' },
  navIcon:       { width: 28, height: 28, borderRadius: 7, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' },
  navIconActive: { backgroundColor: '#4F46E5' },
  navLabel:      { flex: 1, fontSize: 13, fontWeight: '600', color: '#64748B' },
  navLabelActive:{ color: '#E2E8F0', fontWeight: '800' },
  dot:           { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6366F1' },
  footer:        { paddingHorizontal: 12, paddingTop: 8, gap: 6, borderTopWidth: 1, borderTopColor: '#1E293B' },
  backBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#1E293B' },
  backTxt:       { fontSize: 12, fontWeight: '600', color: '#94A3B8' },
  logoutBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#1F1212' },
  logoutTxt:     { fontSize: 12, fontWeight: '700', color: '#EF4444' },
});

const lay = StyleSheet.create({
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },
  desktopRoot: { flex: 1, flexDirection: 'row', backgroundColor: '#0F172A' },
  content:     { flex: 1, backgroundColor: '#F8FAFC', overflow: 'hidden' },
});
