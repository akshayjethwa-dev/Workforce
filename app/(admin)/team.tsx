// app/(admin)/team.tsx
// Task 20: Team Management Screen (Expo React Native)

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Modal, TextInput, Alert, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth }   from './../../src/contexts/AuthContext';
import { dbService } from './../../src/services/db';


// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TeamRole = 'SUPERVISOR' | 'VIEWER';

interface TeamMember {
  uid:        string;
  name:       string;
  email:      string;
  role:       TeamRole | string;
  branch?:    string;
  createdAt?: string;
  isActive?:  boolean;
}

interface Branch {
  id:   string;
  name: string;
}


// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const BRAND = {
  primary: '#4F46E5',
  light:   '#EEF2FF',
  dark:    '#1E1B4B',
};

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  SUPERVISOR: { label: 'Supervisor', color: '#2563EB', bg: '#DBEAFE', icon: 'shield-checkmark-outline' },
  VIEWER:     { label: 'Viewer',     color: '#6B7280', bg: '#F3F4F6', icon: 'eye-outline'              },
  ADMIN:      { label: 'Admin',      color: '#7C3AED', bg: '#EDE9FE', icon: 'star-outline'             },
};

const ROLES: TeamRole[] = ['SUPERVISOR', 'VIEWER'];


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function avatarBg(name: string): string {
  const COLORS = ['#4F46E5','#7C3AED','#0D9488','#D97706','#DC2626','#059669','#2563EB'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}


// ─────────────────────────────────────────────────────────────
// Role Badge
// ─────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.VIEWER;
  return (
    <View style={[badge.wrap, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
      <Text style={[badge.txt, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// Team Member Card
// ─────────────────────────────────────────────────────────────
function TeamMemberCard({
  member, onRemove, isRemoving,
}: {
  member:     TeamMember;
  onRemove:   () => void;
  isRemoving: boolean;
}) {
  const initials = getInitials(member.name || member.email);
  const bg       = avatarBg(member.name || member.email);

  return (
    <View style={mc.card}>
      <View style={mc.left}>
        <View style={[mc.avatar, { backgroundColor: bg }]}>
          <Text style={mc.avatarTxt}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={mc.nameRow}>
            <Text style={mc.name} numberOfLines={1}>
              {member.name || 'Unnamed'}
            </Text>
            <RoleBadge role={member.role} />
          </View>
          <Text style={mc.email} numberOfLines={1}>{member.email}</Text>
          {member.branch && (
            <View style={mc.branchRow}>
              <Ionicons name="business-outline" size={11} color="#6B7280" />
              <Text style={mc.branchTxt}>{member.branch}</Text>
            </View>
          )}
          {member.createdAt && (
            <Text style={mc.joinedTxt}>
              Joined {new Date(member.createdAt).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Text>
          )}
        </View>
      </View>
      <Pressable
        style={[mc.removeBtn, isRemoving && { opacity: 0.4 }]}
        onPress={onRemove}
        disabled={isRemoving}
        hitSlop={10}
      >
        {isRemoving
          ? <ActivityIndicator size="small" color="#DC2626" />
          : <Ionicons name="trash-outline" size={16} color="#DC2626" />
        }
      </Pressable>
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// Pending Invite Card
// ─────────────────────────────────────────────────────────────
function PendingInviteCard({
  invite, onRevoke, isRevoking,
}: {
  invite:     any;
  onRevoke:   () => void;
  isRevoking: boolean;
}) {
  return (
    <View style={[mc.card, mc.pendingCard]}>
      <View style={mc.left}>
        <View style={[mc.avatar, { backgroundColor: '#9CA3AF' }]}>
          <Ionicons name="mail-outline" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={mc.nameRow}>
            <Text style={mc.name} numberOfLines={1}>{invite.email}</Text>
            <View style={[badge.wrap, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="time-outline" size={11} color="#D97706" />
              <Text style={[badge.txt, { color: '#D97706' }]}>Pending</Text>
            </View>
          </View>
          <RoleBadge role={invite.role ?? 'SUPERVISOR'} />
          {invite.createdAt && (
            <Text style={mc.joinedTxt}>
              Invited {new Date(invite.createdAt).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Text>
          )}
        </View>
      </View>
      <Pressable
        style={[mc.removeBtn, isRevoking && { opacity: 0.4 }]}
        onPress={onRevoke}
        disabled={isRevoking}
        hitSlop={10}
      >
        {isRevoking
          ? <ActivityIndicator size="small" color="#DC2626" />
          : <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
        }
      </Pressable>
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// Invite Modal
// ─────────────────────────────────────────────────────────────
function InviteModal({
  visible, branches, onClose, onSubmit, submitting,
}: {
  visible:    boolean;
  branches:   Branch[];
  onClose:    () => void;
  onSubmit:   (email: string, role: TeamRole, branch: string) => Promise<void>;
  submitting: boolean;
}) {
  const [email,  setEmail]  = useState('');
  const [role,   setRole]   = useState<TeamRole>('SUPERVISOR');
  const [branch, setBranch] = useState('');
  const [errors, setErrors] = useState<{ email?: string }>({});

  const reset = () => { setEmail(''); setRole('SUPERVISOR'); setBranch(''); setErrors({}); };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    const errs: { email?: string } = {};
    if (!email.trim())             errs.email = 'Email is required.';
    else if (!isValidEmail(email)) errs.email = 'Enter a valid email address.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    await onSubmit(email.trim().toLowerCase(), role, branch);
    reset();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={inv.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={inv.sheet}>
          {/* Header */}
          <View style={inv.header}>
            <View style={inv.headerIcon}>
              <Ionicons name="person-add-outline" size={20} color={BRAND.primary} />
            </View>
            <Text style={inv.headerTxt}>Invite Team Member</Text>
            <Pressable style={inv.closeBtn} onPress={handleClose}>
              <Ionicons name="close" size={20} color="#374151" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={inv.body} keyboardShouldPersistTaps="handled">

            {/* Email */}
            <View style={inv.fieldGroup}>
              <Text style={inv.label}>Email Address <Text style={inv.required}>*</Text></Text>
              <View style={[inv.inputWrap, errors.email && inv.inputError]}>
                <Ionicons name="mail-outline" size={16} color="#9CA3AF" style={inv.inputIcon} />
                <TextInput
                  style={inv.input}
                  placeholder="colleague@company.com"
                  placeholderTextColor="#9CA3AF"
                  value={email}
                  onChangeText={(t) => { setEmail(t); setErrors((e) => ({ ...e, email: undefined })); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {errors.email && (
                <View style={inv.errorRow}>
                  <Ionicons name="alert-circle-outline" size={12} color="#DC2626" />
                  <Text style={inv.errorTxt}>{errors.email}</Text>
                </View>
              )}
            </View>

            {/* Role */}
            <View style={inv.fieldGroup}>
              <Text style={inv.label}>Role <Text style={inv.required}>*</Text></Text>
              <View style={inv.roleRow}>
                {ROLES.map((r) => {
                  const cfg      = ROLE_CONFIG[r];
                  const isActive = role === r;
                  return (
                    <Pressable
                      key={r}
                      style={[inv.roleChip, isActive && { backgroundColor: cfg.bg, borderColor: cfg.color }]}
                      onPress={() => setRole(r)}
                    >
                      <Ionicons
                        name={cfg.icon as any}
                        size={14}
                        color={isActive ? cfg.color : '#9CA3AF'}
                      />
                      <Text style={[inv.roleChipTxt, isActive && { color: cfg.color }]}>
                        {cfg.label}
                      </Text>
                      {isActive && (
                        <Ionicons name="checkmark-circle" size={14} color={cfg.color} />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {/* Role description */}
              <View style={inv.roleDesc}>
                {role === 'SUPERVISOR' ? (
                  <>
                    <Text style={inv.roleDescTitle}>Supervisor permissions:</Text>
                    <Text style={inv.roleDescItem}>• Mark attendance for workers</Text>
                    <Text style={inv.roleDescItem}>• View reports and payroll</Text>
                    <Text style={inv.roleDescItem}>• Manage workers in their branch</Text>
                  </>
                ) : (
                  <>
                    <Text style={inv.roleDescTitle}>Viewer permissions:</Text>
                    <Text style={inv.roleDescItem}>• View attendance records</Text>
                    <Text style={inv.roleDescItem}>• View reports (read-only)</Text>
                    <Text style={inv.roleDescItem}>• Cannot make changes</Text>
                  </>
                )}
              </View>
            </View>

            {/* Branch (optional) */}
            {branches.length > 0 && (
              <View style={inv.fieldGroup}>
                <Text style={inv.label}>Branch <Text style={inv.optional}>(optional)</Text></Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={inv.branchRow}>
                    <Pressable
                      style={[inv.branchChip, !branch && inv.branchChipActive]}
                      onPress={() => setBranch('')}
                    >
                      <Text style={[inv.branchChipTxt, !branch && inv.branchChipActiveTxt]}>
                        All Branches
                      </Text>
                    </Pressable>
                    {branches.map((b) => (
                      <Pressable
                        key={b.id}
                        style={[inv.branchChip, branch === b.name && inv.branchChipActive]}
                        onPress={() => setBranch(b.name)}
                      >
                        <Text style={[inv.branchChipTxt, branch === b.name && inv.branchChipActiveTxt]}>
                          {b.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Info note */}
            <View style={inv.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#2563EB" />
              <Text style={inv.infoTxt}>
                An invite will be saved. The team member must sign up using this email to join your workspace.
              </Text>
            </View>

            {/* Submit */}
            <Pressable
              style={[inv.submitBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send-outline" size={16} color="#fff" />
              }
              <Text style={inv.submitTxt}>
                {submitting ? 'Sending Invite…' : 'Send Invite'}
              </Text>
            </Pressable>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}


// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function TeamScreen() {
  const { profile } = useAuth();
  const router      = useRouter();

  const [members,       setMembers]       = useState<TeamMember[]>([]);
  const [invites,       setInvites]       = useState<any[]>([]);
  const [branches,      setBranches]      = useState<Branch[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [showInvite,    setShowInvite]    = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [removingUid,   setRemovingUid]   = useState<string | null>(null);
  const [revokingEmail, setRevokingEmail] = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [teamData, settings] = await Promise.all([
        dbService.getTeam(profile.tenantId),
        dbService.getOrgSettings(profile.tenantId),
      ]);

      const normalised: TeamMember[] = teamData.map((u: any) => ({
        uid:       u.uid ?? u.id ?? '',
        name:      u.name ?? u.displayName ?? '',
        email:     u.email ?? '',
        role:      u.role ?? 'SUPERVISOR',
        branch:    u.branch ?? u.branchName ?? '',
        createdAt: u.createdAt ?? u.joinedAt ?? '',
        isActive:  u.isActive !== false,
      }));

      setMembers(normalised);
      setBranches(settings.branches ?? []);
      await fetchInvites();
    } catch (err: any) {
      setError('Failed to load team data.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenantId]);

  const fetchInvites = useCallback(async () => {
    if (!profile?.tenantId) return;
    try {
      const snap = await (dbService as any).getTeamInvites?.(profile.tenantId) ?? [];
      setInvites(snap);
    } catch {
      setInvites([]);
    }
  }, [profile?.tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Invite submit ────────────────────────────────────────
  const handleInvite = async (email: string, role: TeamRole, branch: string) => {
    if (!profile?.tenantId) return;
    setSubmitting(true);
    try {
      if (members.some((m) => m.email.toLowerCase() === email)) {
        Alert.alert('Already a member', `${email} is already in your team.`);
        return;
      }

      await dbService.inviteManager(profile.tenantId, email, email.split('@')[0]);

      const { db } = await import('./../../src/lib/firebase');
      await (db as any)
        .collection('invites')
        .doc(email)
        .set(
          { role, branch, tenantId: profile.tenantId, createdAt: new Date().toISOString() },
          { merge: true },
        );

      setShowInvite(false);
      Alert.alert('Invite Sent ✓', `Invite saved for ${email}.\nThey can sign up and join your workspace.`);
      await fetchInvites();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to send invite.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Remove member ────────────────────────────────────────
  const handleRemove = (member: TeamMember) => {
    Alert.alert(
      'Remove Team Member',
      `Remove ${member.name || member.email} from your team?\n\nThey will lose access immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingUid(member.uid);
            try {
              await dbService.removeManager(member.uid);
              setMembers((prev) => prev.filter((m) => m.uid !== member.uid));
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Failed to remove member.');
            } finally {
              setRemovingUid(null);
            }
          },
        },
      ],
    );
  };

  // ── Revoke invite ────────────────────────────────────────
  const handleRevokeInvite = (email: string) => {
    Alert.alert(
      'Revoke Invite',
      `Cancel the pending invite for ${email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevokingEmail(email);
            try {
              await dbService.deleteInvite(email);
              setInvites((prev) => prev.filter((i) => i.email !== email));
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Failed to revoke invite.');
            } finally {
              setRevokingEmail(null);
            }
          },
        },
      ],
    );
  };

  // ── Stats ────────────────────────────────────────────────
  const supervisorCount = members.filter((m) => m.role === 'SUPERVISOR').length;
  const viewerCount     = members.filter((m) => m.role === 'VIEWER').length;

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.topBarTitle}>Team Management</Text>
          <Text style={s.topBarSub}>
            {loading ? 'Loading…' : `${members.length} members · ${invites.length} pending`}
          </Text>
        </View>
        <Pressable style={s.refreshBtn} onPress={fetchData} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={BRAND.primary} />
            : <Ionicons name="refresh-outline" size={20} color={BRAND.primary} />
          }
        </Pressable>
      </View>

      {/* ── Error ── */}
      {error && (
        <View style={s.errorBar}>
          <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
          <Text style={s.errorBarTxt}>{error}</Text>
          <Pressable onPress={fetchData}>
            <Text style={s.retryTxt}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={BRAND.primary} />
          <Text style={s.loadingTxt}>Loading team…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingBottom: 40 }}>

            {/* ── Stats bar ── */}
            <View style={s.statsRow}>
              {[
                { label: 'Members',     value: members.length,  color: BRAND.primary, icon: 'people-outline'           },
                { label: 'Supervisors', value: supervisorCount, color: '#2563EB',     icon: 'shield-checkmark-outline' },
                { label: 'Viewers',     value: viewerCount,     color: '#6B7280',     icon: 'eye-outline'              },
                { label: 'Pending',     value: invites.length,  color: '#D97706',     icon: 'time-outline'             },
              ].map((stat) => (
                <View key={stat.label} style={s.statChip}>
                  <Ionicons name={stat.icon as any} size={16} color={stat.color} />
                  <Text style={[s.statVal, { color: stat.color }]}>{stat.value}</Text>
                  <Text style={s.statLbl}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {/* ── Invite button ── */}
            <Pressable style={s.inviteBtn} onPress={() => setShowInvite(true)}>
              <View style={s.inviteBtnIcon}>
                <Ionicons name="person-add-outline" size={20} color={BRAND.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.inviteBtnTxt}>Invite Team Member</Text>
                <Text style={s.inviteBtnSub}>Add a supervisor or viewer to your workspace</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={BRAND.primary} />
            </Pressable>

            {/* ── Active members ── */}
            {members.length > 0 && (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <Ionicons name="people-outline" size={14} color={BRAND.primary} />
                  <Text style={s.sectionTitle}>Active Members</Text>
                  <View style={s.sectionBadge}>
                    <Text style={s.sectionBadgeTxt}>{members.length}</Text>
                  </View>
                </View>
                {members.map((m) => (
                  <TeamMemberCard
                    key={m.uid}
                    member={m}
                    onRemove={() => handleRemove(m)}
                    isRemoving={removingUid === m.uid}
                  />
                ))}
              </View>
            )}

            {/* ── Pending invites ── */}
            {invites.length > 0 && (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <Ionicons name="time-outline" size={14} color="#D97706" />
                  <Text style={[s.sectionTitle, { color: '#D97706' }]}>Pending Invites</Text>
                  <View style={[s.sectionBadge, { backgroundColor: '#FEF3C7' }]}>
                    <Text style={[s.sectionBadgeTxt, { color: '#D97706' }]}>{invites.length}</Text>
                  </View>
                </View>
                {invites.map((inv) => (
                  <PendingInviteCard
                    key={inv.email}
                    invite={inv}
                    onRevoke={() => handleRevokeInvite(inv.email)}
                    isRevoking={revokingEmail === inv.email}
                  />
                ))}
              </View>
            )}

            {/* ── Empty state ── */}
            {members.length === 0 && invites.length === 0 && (
              <View style={s.emptyState}>
                <View style={s.emptyIconWrap}>
                  <Ionicons name="people-outline" size={40} color={BRAND.primary} />
                </View>
                <Text style={s.emptyTitle}>No team members yet</Text>
                <Text style={s.emptySub}>
                  Invite supervisors or viewers to help manage your workforce.
                </Text>
                <Pressable style={s.emptyBtn} onPress={() => setShowInvite(true)}>
                  <Ionicons name="person-add-outline" size={16} color="#fff" />
                  <Text style={s.emptyBtnTxt}>Invite First Member</Text>
                </Pressable>
              </View>
            )}

            {/* ── Role info cards ── */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Ionicons name="information-circle-outline" size={14} color="#6B7280" />
                <Text style={[s.sectionTitle, { color: '#6B7280' }]}>Role Permissions</Text>
              </View>
              {[
                {
                  role:  'SUPERVISOR',
                  perms: ['Mark & manage attendance', 'View reports & payroll', 'Manage workers in branch', 'Cannot change billing or settings'],
                },
                {
                  role:  'VIEWER',
                  perms: ['View attendance records', 'View reports (read-only)', 'Cannot mark attendance', 'Cannot make any changes'],
                },
              ].map((item) => {
                const cfg = ROLE_CONFIG[item.role];
                return (
                  <View key={item.role} style={[s.roleInfoCard, { borderLeftColor: cfg.color }]}>
                    <View style={s.roleInfoHeader}>
                      <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
                      <Text style={[s.roleInfoTitle, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                    {item.perms.map((p) => (
                      <View key={p} style={s.permRow}>
                        <Ionicons
                          name={p.startsWith('Cannot') ? 'close-circle-outline' : 'checkmark-circle-outline'}
                          size={13}
                          color={p.startsWith('Cannot') ? '#9CA3AF' : '#16A34A'}
                        />
                        <Text style={[s.permTxt, p.startsWith('Cannot') && { color: '#9CA3AF' }]}>
                          {p}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>

          </View>
        </ScrollView>
      )}

      {/* ── Invite modal ── */}
      <InviteModal
        visible={showInvite}
        branches={branches}
        onClose={() => setShowInvite(false)}
        onSubmit={handleInvite}
        submitting={submitting}
      />
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// Badge styles
// ─────────────────────────────────────────────────────────────
const badge = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  txt:  { fontSize: 10, fontWeight: '800' },
});


// ─────────────────────────────────────────────────────────────
// Member card styles
// ─────────────────────────────────────────────────────────────
const mc = StyleSheet.create({
  card:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  pendingCard: { borderWidth: 1, borderColor: '#FEF3C7', backgroundColor: '#FFFBEB' },
  left:        { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar:      { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:   { fontSize: 18, fontWeight: '900', color: '#fff' },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name:        { fontSize: 14, fontWeight: '800', color: '#111827', flexShrink: 1 },
  email:       { fontSize: 11, color: '#6B7280', marginTop: 2 },
  branchRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  branchTxt:   { fontSize: 11, color: '#6B7280' },
  joinedTxt:   { fontSize: 10, color: '#9CA3AF', marginTop: 4 },
  removeBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});


// ─────────────────────────────────────────────────────────────
// Invite modal styles
// ─────────────────────────────────────────────────────────────
const inv = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  header:     { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 18, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  headerIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: BRAND.light, alignItems: 'center', justifyContent: 'center' },
  headerTxt:  { flex: 1, fontSize: 16, fontWeight: '900', color: '#111827' },
  closeBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  body:       { padding: 18, gap: 18, paddingBottom: 40 },

  fieldGroup: { gap: 6 },
  label:      { fontSize: 13, fontWeight: '700', color: '#374151' },
  required:   { color: '#DC2626' },
  optional:   { fontSize: 11, fontWeight: '400', color: '#9CA3AF' },

  inputWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', paddingHorizontal: 12, height: 48 },
  inputError: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  inputIcon:  { marginRight: 8 },
  input:      { flex: 1, fontSize: 14, color: '#111827' },

  errorRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  errorTxt:   { fontSize: 11, color: '#DC2626' },

  roleRow:    { flexDirection: 'row', gap: 10 },
  roleChip:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', paddingVertical: 12 },
  roleChipTxt:{ fontSize: 13, fontWeight: '700', color: '#9CA3AF' },

  roleDesc:      { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, gap: 4, marginTop: 4 },
  roleDescTitle: { fontSize: 11, fontWeight: '800', color: '#374151', marginBottom: 2 },
  roleDescItem:  { fontSize: 11, color: '#6B7280' },

  branchRow:          { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  branchChip:         { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F3F4F6', borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent' },
  branchChipActive:   { backgroundColor: BRAND.light, borderColor: BRAND.primary },
  branchChipTxt:      { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  branchChipActiveTxt:{ color: BRAND.primary, fontWeight: '800' },

  infoBox:  { flexDirection: 'row', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12 },
  infoTxt:  { flex: 1, fontSize: 12, color: '#2563EB', lineHeight: 18 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND.primary, borderRadius: 14, paddingVertical: 14 },
  submitTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
});


// ─────────────────────────────────────────────────────────────
// Main styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#F9FAFB' },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  topBar:      { paddingTop: 52, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 17, fontWeight: '900', color: '#111827' },
  topBarSub:   { fontSize: 11, color: '#6B7280', marginTop: 1 },
  refreshBtn:  { width: 36, height: 36, borderRadius: 10, backgroundColor: BRAND.light, alignItems: 'center', justifyContent: 'center' },

  errorBar:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 12, marginHorizontal: 14, marginTop: 10, padding: 10 },
  errorBarTxt: { flex: 1, fontSize: 12, color: '#DC2626' },
  retryTxt:    { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  loadingTxt:  { fontSize: 13, color: '#9CA3AF' },

  statsRow:  { flexDirection: 'row', gap: 8, padding: 14 },
  statChip:  { flex: 1, alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, gap: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statVal:   { fontSize: 20, fontWeight: '900' },
  statLbl:   { fontSize: 9, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase' },

  inviteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', marginHorizontal: 14, marginBottom: 8, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: BRAND.primary, borderStyle: 'dashed' },
  inviteBtnIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: BRAND.light, alignItems: 'center', justifyContent: 'center' },
  inviteBtnTxt:  { fontSize: 14, fontWeight: '800', color: BRAND.primary },
  inviteBtnSub:  { fontSize: 11, color: '#6B7280', marginTop: 2 },

  section:        { marginHorizontal: 14, marginTop: 8 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle:   { flex: 1, fontSize: 12, fontWeight: '900', color: BRAND.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionBadge:   { backgroundColor: BRAND.light, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  sectionBadgeTxt:{ fontSize: 11, fontWeight: '800', color: BRAND.primary },

  emptyState:   { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 12 },
  emptyIconWrap:{ width: 80, height: 80, borderRadius: 24, backgroundColor: BRAND.light, alignItems: 'center', justifyContent: 'center' },
  emptyTitle:   { fontSize: 18, fontWeight: '900', color: '#111827' },
  emptySub:     { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  emptyBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BRAND.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 4 },
  emptyBtnTxt:  { fontSize: 14, fontWeight: '700', color: '#fff' },

  roleInfoCard:   { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, borderLeftWidth: 3 },
  roleInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  roleInfoTitle:  { fontSize: 13, fontWeight: '900' },
  permRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  permTxt:        { fontSize: 12, color: '#374151' },
});
