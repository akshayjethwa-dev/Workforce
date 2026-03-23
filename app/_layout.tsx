// app/_layout.tsx
import { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { useNetworkSync } from '../src/hooks/useNetworkSync';

function RootGuard() {
  const { user, profile, loading } = useAuth();
  const router   = useRouter();
  const segments = useSegments();

  // ✅ Mount here — runs for the entire app session once logged in
  useNetworkSync();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup       = segments[0] === '(auth)';
    const inAdminGroup      = segments[0] === '(admin)';
    const inSuperAdminGroup = segments[0] === '(superadmin)';

    // ── Not logged in → force to login ──────────────────────
    if (!user) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login' as any);
      }
      return;
    }

    // ── Logged in but on auth screen → redirect by role ─────
    if (inAuthGroup) {
      if (profile?.role === 'SUPER_ADMIN') {
        router.replace('/(superadmin)/' as any);
      } else {
        router.replace('/(admin)/' as any);
      }
      return;
    }

    // ── Block non-super-admins from (superadmin) routes ─────
    if (inSuperAdminGroup && profile?.role !== 'SUPER_ADMIN') {
      router.replace('/(admin)/' as any);
      return;
    }

    // ── Super admin visiting (admin) → allowed for impersonation
    // No redirect needed here.

    // ── Logged in user not in any known group ────────────────
    if (!inAdminGroup && !inSuperAdminGroup) {
      if (profile?.role === 'SUPER_ADMIN') {
        router.replace('/(superadmin)/' as any);
      } else {
        router.replace('/(admin)/' as any);
      }
    }
  }, [user, profile, loading, segments]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootGuard />
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
