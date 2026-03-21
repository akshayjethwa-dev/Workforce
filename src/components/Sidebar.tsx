// src/components/Sidebar.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const NAV_ITEMS = [
  { label: 'Dashboard',  icon: 'grid-outline' as const,        route: '/(admin)/' },
  { label: 'Workers',    icon: 'people-outline' as const,      route: '/(admin)/workers/' },
  { label: 'Attendance', icon: 'checkmark-circle-outline' as const, route: '/(admin)/attendance/' },
  { label: 'Payroll',    icon: 'cash-outline' as const,        route: '/(admin)/payroll' },
  { label: 'Settings',   icon: 'settings-outline' as const,    route: '/(admin)/settings/' },
] as const;

const ACTIVE_COLOR = '#4F46E5';
const INACTIVE_COLOR = '#9CA3AF';

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.sidebar}>
      <View style={styles.logoArea}>
        <Text style={styles.logoText}>WorkforcePro</Text>
      </View>

      {NAV_ITEMS.map(({ label, icon, route }) => {
        const isActive =
          pathname === route ||
          pathname.startsWith(route.replace(/\/$/, ''));
        const iconColor = isActive ? ACTIVE_COLOR : INACTIVE_COLOR;

        return (
          <Pressable
            key={label}
            style={[styles.navItem, isActive && styles.navItemActive]}
            onPress={() => router.push(route as any)}
          >
            <Ionicons name={icon} size={20} color={iconColor} />
            <Text style={[styles.navLabel, { color: iconColor }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    paddingTop: 24,
    paddingHorizontal: 12,
    height: '100%',
  },
  logoArea: {
    paddingHorizontal: 12,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4F46E5',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  navItemActive: {
    backgroundColor: '#EEF2FF',
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
});
