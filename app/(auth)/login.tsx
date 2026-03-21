// app/(auth)/login.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../../src/lib/firebase';
import { dbService } from '../../src/services/db';

export default function LoginScreen() {
  const router = useRouter();

  // Standard login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Kiosk modal state
  const [kioskModalVisible, setKioskModalVisible] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [kioskLoading, setKioskLoading] = useState(false);
  const [kioskError, setKioskError] = useState('');

  // ── Standard Login ──────────────────────────────────────
  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      await (auth as any).signInWithEmailAndPassword(email.trim(), password);
      // _layout.tsx RootGuard handles redirect after auth state changes
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') ?? 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot Password ─────────────────────────────────────
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Please enter your email address first.');
      return;
    }
    setResetLoading(true);
    setError('');
    try {
      await (auth as any).sendPasswordResetEmail(email.trim());
      setSuccessMsg('Password reset email sent! Check your inbox.');
    } catch (err: any) {
      setError(err.message?.replace('Firebase: ', '') ?? 'Failed to send reset email.');
    } finally {
      setResetLoading(false);
    }
  };

  // ── Kiosk Login ─────────────────────────────────────────
  const handleKioskLogin = async () => {
    if (pairingCode.length !== 6) {
      setKioskError('Pairing code must be exactly 6 digits.');
      return;
    }
    setKioskLoading(true);
    setKioskError('');
    try {
      const config = await dbService.verifyKioskPairingCode(pairingCode);
      if (!config) throw new Error('Invalid or expired pairing code.');

      // Save kiosk config to AsyncStorage for the kiosk screen to use
      await AsyncStorage.setItem('kiosk_config', JSON.stringify(config));
      setKioskModalVisible(false);
      router.replace('/kiosk' as any);
    } catch (err: any) {
      setKioskError(err.message ?? 'Kiosk login failed.');
    } finally {
      setKioskLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo placeholder */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoCircle}>
            <Ionicons name="briefcase-outline" size={36} color="#4F46E5" />
          </View>
          <Text style={styles.appName}>WorkforcePro</Text>
          <Text style={styles.appTagline}>Factory Attendance & Payroll</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome Back</Text>
          <Text style={styles.cardSubtitle}>Sign in to your account</Text>

          {/* Error / Success banners */}
          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {!!successMsg && (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>{successMsg}</Text>
            </View>
          )}

          {/* Email */}
          <Text style={styles.label}>Email Address</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="admin@company.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          {/* Password */}
          <View style={styles.labelRow}>
            <Text style={styles.label}>Password</Text>
            <Pressable onPress={handleForgotPassword} disabled={resetLoading}>
              <Text style={styles.forgotText}>
                {resetLoading ? 'Sending...' : 'Forgot Password?'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={[styles.input, styles.inputFlex]}
              placeholder="••••••••"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
            />
            <Pressable onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color="#9CA3AF"
              />
            </Pressable>
          </View>

          {/* Login button */}
          <Pressable
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>Login to Dashboard</Text>
            }
          </Pressable>

          {/* Register link */}
          <View style={styles.registerRow}>
            <Text style={styles.mutedText}>Don't have an account? </Text>
            <Pressable onPress={() => router.push('/(auth)/register' as any)}>
              <Text style={styles.linkText}>Register New Company</Text>
            </Pressable>
          </View>
        </View>

        {/* Kiosk login button */}
        <Pressable
          style={styles.kioskBtn}
          onPress={() => { setKioskModalVisible(true); setPairingCode(''); setKioskError(''); }}
        >
          <Ionicons name="tv-outline" size={18} color="#4F46E5" />
          <Text style={styles.kioskBtnText}>Login as Kiosk Terminal</Text>
        </Pressable>
      </ScrollView>

      {/* ── Kiosk Modal ───────────────────────────────────── */}
      <Modal
        visible={kioskModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setKioskModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="tv-outline" size={28} color="#4F46E5" />
              <Text style={styles.modalTitle}>Kiosk Terminal Login</Text>
              <Text style={styles.modalSubtitle}>
                Enter the 6-digit pairing code from your WorkforcePro settings
              </Text>
            </View>

            {!!kioskError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{kioskError}</Text>
              </View>
            )}

            <TextInput
              style={styles.kioskCodeInput}
              placeholder="------"
              placeholderTextColor="#D1D5DB"
              keyboardType="number-pad"
              maxLength={6}
              value={pairingCode}
              onChangeText={t => setPairingCode(t.replace(/\D/g, ''))}
              textAlign="center"
            />

            <Pressable
              style={[styles.primaryBtn, kioskLoading && styles.btnDisabled]}
              onPress={handleKioskLogin}
              disabled={kioskLoading}
            >
              {kioskLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Launch Terminal</Text>
              }
            </Pressable>

            <Pressable
              style={styles.cancelBtn}
              onPress={() => setKioskModalVisible(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F5F3FF' },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    paddingBottom: 40,
  },

  // Logo
  logoWrapper: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  appName: { fontSize: 22, fontWeight: '800', color: '#1E1B4B' },
  appTagline: { fontSize: 13, color: '#6B7280', marginTop: 2 },

  // Card
  card: {
    width: '100%', maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#6B7280', marginBottom: 20 },

  // Banners
  errorBanner: {
    backgroundColor: '#FEF2F2', borderRadius: 8,
    padding: 10, marginBottom: 12,
  },
  errorText: { color: '#DC2626', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  successBanner: {
    backgroundColor: '#F0FDF4', borderRadius: 8,
    padding: 10, marginBottom: 12,
  },
  successText: { color: '#16A34A', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Inputs
  label: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  forgotText: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, marginBottom: 16,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: {
    flex: 1, fontSize: 14, fontWeight: '500',
    color: '#111827', paddingVertical: 12,
  },
  inputFlex: { flex: 1 },
  eyeBtn: { padding: 4 },

  // Buttons
  primaryBtn: {
    backgroundColor: '#4F46E5', borderRadius: 12,
    padding: 14, alignItems: 'center',
    marginTop: 4, marginBottom: 16,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Register
  registerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  mutedText: { fontSize: 13, color: '#6B7280' },
  linkText: { fontSize: 13, color: '#4F46E5', fontWeight: '700' },

  // Kiosk button (outside card)
  kioskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 20, paddingVertical: 12, paddingHorizontal: 24,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
  },
  kioskBtnText: { color: '#4F46E5', fontWeight: '700', fontSize: 14 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 28, paddingBottom: 40,
  },
  modalHeader: { alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 8 },
  modalSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 4, textAlign: 'center' },
  kioskCodeInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, padding: 16,
    fontSize: 28, fontWeight: '700',
    letterSpacing: 12, color: '#111827',
    marginBottom: 16,
  },
  cancelBtn: {
    alignItems: 'center', paddingVertical: 12,
  },
  cancelBtnText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
});
