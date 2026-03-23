// app/_layout.tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { useNetworkSync } from '../src/hooks/useNetworkSync';
import { KIOSK_CONFIG_KEY } from '../src/services/kioskPunchService';

// ─── Step 1: Check AsyncStorage BEFORE mounting AuthProvider ──────────────────
// This mirrors original RootNavigator's: useState(() => localStorage.getItem('kiosk_config'))
function KioskBootCheck({ onDone }: { onDone: (isKiosk: boolean) => void }) {
  useEffect(() => {
    AsyncStorage.getItem(KIOSK_CONFIG_KEY)
      .then((raw) => onDone(!!raw))
      .catch(() => onDone(false));
  }, []);
  return null;
}

// ─── Step 2: Auth + Route guard (only runs if NOT kiosk) ──────────────────────
function RootGuard({ isKioskMode }: { isKioskMode: boolean }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  // Cast to string[] — avoids TS union type error when comparing 'kiosk'
  const segments = useSegments() as string[];

  useNetworkSync();

  useEffect(() => {
    const seg0 = segments[0] ?? '';

    // ── Dedicated kiosk device → always lock to /kiosk ────────────────────
    // Mirrors: if (kioskConfig) return <AttendanceKioskScreen isDedicatedMode={true} />
    if (isKioskMode) {
      if (seg0 !== 'kiosk') {
        router.replace('/kiosk' as any);
      }
      return;
    }

    if (loading) return;

    const inAuthGroup       = seg0 === '(auth)';
    const inAdminGroup      = seg0 === '(admin)';
    const inSuperAdminGroup = seg0 === '(superadmin)';
    const inKioskRoute      = seg0 === 'kiosk';

    // Not logged in
    if (!user) {
      if (!inAuthGroup && !inKioskRoute) {
        router.replace('/(auth)/login' as any);
      }
      return;
    }

    // Logged in on auth screen → redirect by role
    if (inAuthGroup) {
      if (profile?.role === 'SUPER_ADMIN') {
        router.replace('/(superadmin)/' as any);
      } else {
        router.replace('/(admin)/' as any);
      }
      return;
    }

    // Block non-super-admins from superadmin routes
    if (inSuperAdminGroup && profile?.role !== 'SUPER_ADMIN') {
      router.replace('/(admin)/' as any);
      return;
    }

    // Logged in but not in any known group
    if (!inAdminGroup && !inSuperAdminGroup && !inKioskRoute) {
      if (profile?.role === 'SUPER_ADMIN') {
        router.replace('/(superadmin)/' as any);
      } else {
        router.replace('/(admin)/' as any);
      }
    }
  }, [user, profile, loading, segments, isKioskMode]);

  if (loading && !isKioskMode) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return <Slot />;
}

// ─── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout() {
  const [kioskChecked, setKioskChecked] = useState(false);
  const [isKioskMode, setIsKioskMode]   = useState(false);

  // Show splash while reading AsyncStorage (same as original's localStorage init)
  if (!kioskChecked) {
    return (
      <>
        <KioskBootCheck
          onDone={(isKiosk) => {
            setIsKioskMode(isKiosk);
            setKioskChecked(true);
          }}
        />
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </>
    );
  }

  return (
    <AuthProvider>
      <RootGuard isKioskMode={isKioskMode} />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
