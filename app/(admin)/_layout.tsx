// app/(admin)/_layout.tsx
import { useWindowDimensions, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
// ✅ No firebase imports here at all — use useAuth signOut instead
import { useAuth } from '../../src/contexts/AuthContext';
import { useNetworkSync } from '../../src/hooks/useNetworkSync';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const ACTIVE   = '#4F46E5';
const INACTIVE = '#9CA3AF';

const NAV_ITEMS = [
  { label: 'Dashboard',  icon: 'grid-outline',             route: '/(admin)/dashboard'  },
  { label: 'Workers',    icon: 'people-outline',           route: '/(admin)/workers'    },
  { label: 'Attendance', icon: 'checkmark-circle-outline', route: '/(admin)/attendance' },
  { label: 'Payroll',    icon: 'cash-outline',             route: '/(admin)/payroll'    },
  { label: 'Daily Logs', icon: 'document-text-outline',    route: '/(admin)/daily-logs' },
  { label: 'Reports',    icon: 'pie-chart-outline',        route: '/(admin)/reports'    },
  { label: 'ID Cards',   icon: 'card-outline',             route: '/(admin)/id-cards'   },
  { label: 'Team',       icon: 'shield-checkmark-outline', route: '/(admin)/team'       },
  { label: 'Billing',    icon: 'receipt-outline',          route: '/(admin)/billing'    },
  { label: 'Settings',   icon: 'settings-outline',         route: '/(admin)/settings'   },
] as const;

const SUPER_ADMIN_ITEMS = [
  { label: 'Master Dashboard', icon: 'shield-outline', route: '/(admin)/super-admin' },
] as const;

// ─────────────────────────────────────────────────────────────
// Desktop Sidebar
// ─────────────────────────────────────────────────────────────
function DesktopSidebar() {
  const { profile, logout } = useAuth(); // ✅ use logout from context
  const router               = useRouter();
  const pathname             = usePathname();
  const isSuperAdmin         = profile?.role === 'SUPER_ADMIN';
  const items                = isSuperAdmin ? SUPER_ADMIN_ITEMS : NAV_ITEMS;

  return (
    <View style={sb.root}>
      {/* Brand header */}
      <View style={sb.header}>
        <View style={sb.logoBox}>
          <Text style={sb.logoTxt}>WP</Text>
        </View>
        <View>
          <Text style={sb.brandName}>WorkforcePro</Text>
          <Text style={sb.brandSub} numberOfLines={1}>
            {(profile as any)?.companyName ?? profile?.email ?? ''}
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Role chip */}
        <View style={sb.roleRow}>
          <View style={[sb.roleChip, isSuperAdmin && sb.roleChipSuper]}>
            <Ionicons
              name={isSuperAdmin ? 'shield-checkmark' : 'person-circle-outline'}
              size={12}
              color={isSuperAdmin ? '#7C3AED' : '#4F46E5'}
            />
            <Text style={[sb.roleTxt, isSuperAdmin && { color: '#7C3AED' }]}>
              {isSuperAdmin ? 'Super Admin' : (profile?.role ?? 'Admin')}
            </Text>
          </View>
        </View>

        {/* Nav items */}
        <View style={sb.nav}>
          {items.map((item) => {
            const isActive = pathname.startsWith(item.route.replace('/(admin)', ''));
            return (
              <Pressable
                key={item.route}
                style={[sb.navItem, isActive && sb.navItemActive]}
                onPress={() => router.push(item.route as any)}
              >
                <View style={[sb.navIconBox, isActive && sb.navIconBoxActive]}>
                  <Ionicons
                    name={item.icon as any}
                    size={18}
                    color={isActive ? '#fff' : INACTIVE}
                  />
                </View>
                <Text style={[sb.navLabel, isActive && sb.navLabelActive]}>
                  {item.label}
                </Text>
                {isActive && <View style={sb.activeIndicator} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* ✅ logout from AuthContext — no firebase import needed */}
      <Pressable style={sb.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color="#DC2626" />
        <Text style={sb.logoutTxt}>Logout</Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab screen declarations (shared desktop + mobile)
// ─────────────────────────────────────────────────────────────
const TAB_SCREENS = (
  <>
    <Tabs.Screen
      name="dashboard"
      options={{
        title: 'Dashboard',
        tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="workers"
      options={{
        title: 'Workers',
        tabBarIcon: ({ color }) => <Ionicons name="people-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="attendance"
      options={{
        title: 'Attendance',
        tabBarIcon: ({ color }) => <Ionicons name="checkmark-circle-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="payroll"
      options={{
        title: 'Payroll',
        tabBarIcon: ({ color }) => <Ionicons name="cash-outline" size={22} color={color} />,
      }}
    />
    <Tabs.Screen
      name="settings"
      options={{
        title: 'Settings',
        tabBarIcon: ({ color }) => <Ionicons name="settings-outline" size={22} color={color} />,
      }}
    />
    {/* Hidden from tab bar — still routable via router.push() */}
    <Tabs.Screen name="daily-logs"     options={{ href: null }} />
    <Tabs.Screen name="reports"        options={{ href: null }} />
    <Tabs.Screen name="id-cards"       options={{ href: null }} />
    <Tabs.Screen name="team"           options={{ href: null }} />
    <Tabs.Screen name="billing"        options={{ href: null }} />
    <Tabs.Screen name="worker-history" options={{ href: null }} />
    <Tabs.Screen name="super-admin"    options={{ href: null }} />
    <Tabs.Screen name="add-worker"     options={{ href: null }} />
  </>
);

// ─────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────
export default function AdminLayout() {
    useNetworkSync();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return (
      <View style={lay.desktopRoot}>
        <DesktopSidebar />
        <View style={lay.desktopContent}>
          <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
            {TAB_SCREENS}
          </Tabs>
        </View>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor:   ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor:  '#E5E7EB',
          borderTopWidth:  1,
          height:          62,
          paddingBottom:   10,
          paddingTop:      4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
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
  root:             { width: 220, backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: '#F3F4F6', paddingBottom: 16 },
  header:           { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', backgroundColor: '#1E1B4B' },
  logoBox:          { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  logoTxt:          { fontSize: 14, fontWeight: '900', color: '#fff' },
  brandName:        { fontSize: 13, fontWeight: '900', color: '#fff' },
  brandSub:         { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1, maxWidth: 130 },
  roleRow:          { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  roleChip:         { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#EEF2FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  roleChipSuper:    { backgroundColor: '#EDE9FE' },
  roleTxt:          { fontSize: 10, fontWeight: '800', color: '#4F46E5' },
  nav:              { paddingHorizontal: 10, paddingTop: 4, gap: 2 },
  navItem:          { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10 },
  navItemActive:    { backgroundColor: '#EEF2FF' },
  navIconBox:       { width: 30, height: 30, borderRadius: 8, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  navIconBoxActive: { backgroundColor: '#4F46E5' },
  navLabel:         { flex: 1, fontSize: 13, fontWeight: '600', color: '#6B7280' },
  navLabelActive:   { color: '#4F46E5', fontWeight: '800' },
  activeIndicator:  { width: 4, height: 4, borderRadius: 2, backgroundColor: '#4F46E5' },
  logoutBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 8, backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  logoutTxt:        { fontSize: 13, fontWeight: '700', color: '#DC2626' },
});

const lay = StyleSheet.create({
  desktopRoot:    { flex: 1, flexDirection: 'row', backgroundColor: '#F9FAFB' },
  desktopContent: { flex: 1, overflow: 'hidden' },
});
