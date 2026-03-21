// app/(auth)/register.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../../src/lib/firebase';
import { dbService } from '../../src/services/db';

export default function RegisterScreen() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    companyName: '',
    name: '',
    phone: '',
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const update = (key: keyof typeof formData, val: string) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  // ── Validation ───────────────────────────────────────────
  const validatePassword = (pw: string) => {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(pw);
  };

  // ── Register Handler ─────────────────────────────────────
  const handleRegister = async () => {
    setError('');
    const { companyName, name, phone, email, password } = formData;

    if (!companyName.trim()) return setError('Company Name is required.');
    if (!name.trim()) return setError('Your Name is required.');
    if (!/^\d{10}$/.test(phone)) return setError('Valid 10-digit phone number is required.');
    if (!email.trim()) return setError('Email Address is required.');
    if (!validatePassword(password)) {
      return setError(
        'Password must be 8+ chars with uppercase, lowercase, number & special character.'
      );
    }

    setLoading(true);
    try {
      // 1. Create Firebase Auth user
      const userCredential = await (auth as any).createUserWithEmailAndPassword(
        email.trim(), password
      );
      const user = userCredential.user;

      // 2. Check if invited
      const invite = await dbService.checkInvite(email.trim().toLowerCase());

      let finalTenantId = '';
      let finalRole = 'FACTORY_OWNER';
      let finalCompanyName = companyName.trim();

      if (invite) {
        // Joining an existing company via invite
        finalTenantId = invite.tenantId;
        finalRole = invite.role;
        finalCompanyName = 'Joined via Invite';
        await dbService.deleteInvite(email.trim().toLowerCase());
      } else {
        // 3. Create tenant document with 30-day TRIAL
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 30);

        const tenantRef = await (db as any).collection('tenants').add({
          name: companyName.trim(),
          ownerId: user.uid,
          createdAt: new Date().toISOString(),
          plan: 'TRIAL',
          trialEndsAt: trialEndDate.toISOString(),
        });
        finalTenantId = tenantRef.id;

        // 4. Create default OrgSettings document
        await (db as any).collection('settings').doc(finalTenantId).set({
          shifts: [{
            id: 'default',
            name: 'Day Shift',
            startTime: '09:00',
            endTime: '18:00',
            gracePeriodMins: 15,
            maxGraceAllowed: 3,
            breakDurationMins: 60,
            minOvertimeMins: 60,
            minHalfDayHours: 4,
          }],
          branches: [{ id: 'default', name: 'Main Site' }],
          departments: [],
          weeklyOffs: { defaultDays: [0], saturdayRule: 'NONE' },
          holidays: [],
          enableBreakTracking: false,
          strictLiveness: false,
          holidayPayMultiplier: 2.0,
          compliance: {
            pfRegistrationNumber: '',
            esicCode: '',
            capPfDeduction: true,
            dailyWagePfPercentage: 100,
            pfContributionRate: 12,
            epsContributionRate: 8.33,
            epfWageCeiling: 15000,
          },
        });
      }

      // 5. Create user profile document
      await (db as any).collection('users').doc(user.uid).set({
        uid: user.uid,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        role: finalRole,
        tenantId: finalTenantId,
        companyName: finalCompanyName,
        createdAt: new Date().toISOString(),
      });

      // 6. Update Firebase Auth display name
      await user.updateProfile({ displayName: name.trim() });

      // 7. Navigate to login (RootGuard handles rest)
      router.replace('/(auth)/login' as any);

    } catch (err: any) {
      console.error(err);
      setError(err.message?.replace('Firebase: ', '') ?? 'Registration failed.');
    } finally {
      setLoading(false);
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
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="business-outline" size={32} color="#4F46E5" />
          </View>
          <Text style={styles.title}>Setup Your Account</Text>
          <Text style={styles.subtitle}>Start your 30-day free trial today</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Company Name */}
          <Text style={styles.label}>Company Name *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="business-outline" size={18} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="Ex: Jethwa Industries"
              placeholderTextColor="#9CA3AF"
              value={formData.companyName}
              onChangeText={v => update('companyName', v)}
            />
          </View>

          {/* Owner Name */}
          <Text style={styles.label}>Your Name *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={18} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              placeholderTextColor="#9CA3AF"
              value={formData.name}
              onChangeText={v => update('name', v)}
            />
          </View>

          {/* Phone */}
          <Text style={styles.label}>Phone Number *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="call-outline" size={18} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="10-digit mobile number"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              maxLength={10}
              value={formData.phone}
              onChangeText={v => update('phone', v.replace(/\D/g, ''))}
            />
          </View>

          {/* Email */}
          <Text style={styles.label}>Email Address *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={18} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={styles.input}
              placeholder="admin@company.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={formData.email}
              onChangeText={v => update('email', v)}
            />
          </View>

          {/* Password */}
          <Text style={styles.label}>Password *</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={18} color="#9CA3AF" style={styles.icon} />
            <TextInput
              style={[styles.input, styles.inputFlex]}
              placeholder="••••••••"
              placeholderTextColor="#9CA3AF"
              secureTextEntry={!showPassword}
              value={formData.password}
              onChangeText={v => update('password', v)}
            />
            <Pressable onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color="#9CA3AF"
              />
            </Pressable>
          </View>
          <Text style={styles.hintText}>
            Min 8 chars • uppercase • lowercase • number • special char
          </Text>

          {/* Submit */}
          <Pressable
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <View style={styles.btnRow}>
                  <Text style={styles.primaryBtnText}>Create Account</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
                </View>
              )
            }
          </Pressable>

          {/* Login link */}
          <View style={styles.loginRow}>
            <Text style={styles.mutedText}>Already have an account? </Text>
            <Pressable onPress={() => router.replace('/(auth)/login' as any)}>
              <Text style={styles.linkText}>Login here</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F9FAFB' },
  container: {
    flexGrow: 1, alignItems: 'center',
    padding: 20, paddingBottom: 48,
    paddingTop: 40,
  },

  header: { alignItems: 'center', marginBottom: 24 },
  logoCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 4 },

  card: {
    width: '100%', maxWidth: 440,
    backgroundColor: '#fff', borderRadius: 20,
    padding: 24,
    shadowColor: '#000', shadowOpacity: 0.07,
    shadowRadius: 14, elevation: 3,
  },

  errorBanner: {
    backgroundColor: '#FEF2F2', borderRadius: 8,
    padding: 10, marginBottom: 14,
  },
  errorText: { color: '#DC2626', fontSize: 12, textAlign: 'center', fontWeight: '500' },

  label: {
    fontSize: 11, fontWeight: '700',
    color: '#374151', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, marginBottom: 14,
    paddingHorizontal: 12,
  },
  icon: { marginRight: 8 },
  input: {
    flex: 1, fontSize: 14, fontWeight: '500',
    color: '#111827', paddingVertical: 12,
  },
  inputFlex: { flex: 1 },
  eyeBtn: { padding: 4 },
  hintText: {
    fontSize: 10, color: '#9CA3AF',
    marginTop: -10, marginBottom: 14,
  },

  primaryBtn: {
    backgroundColor: '#4F46E5', borderRadius: 12,
    padding: 14, alignItems: 'center',
    marginTop: 6, marginBottom: 16,
  },
  btnDisabled: { opacity: 0.6 },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  loginRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
  },
  mutedText: { fontSize: 13, color: '#6B7280' },
  linkText: { fontSize: 13, color: '#4F46E5', fontWeight: '700' },
});
