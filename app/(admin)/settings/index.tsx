// app/(admin)/settings/index.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Switch, ActivityIndicator, Alert, Animated, Platform,
  KeyboardAvoidingView, Modal,
} from 'react-native';
import { getFirestore, doc, updateDoc } from '@react-native-firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../../../src/contexts/AuthContext';
import { dbService } from '../../../src/services/db';
import {
  OrgSettings, ShiftConfig, Branch, KioskTerminal,
  Holiday, LeavePolicy, WeeklyOffConfig, SaturdayOffType,
} from '../../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const SATURDAY_RULES: { label: string; value: SaturdayOffType }[] = [
  { label: 'All Saturdays Off',      value: 'ALL' },
  { label: 'Alternate (2nd & 4th)',  value: 'ALTERNATE' },
  { label: '1st & 3rd Off',          value: 'FIRST_THIRD' },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatHolidayDate(dateStr: string) {
  const d = new Date(dateStr);
  return {
    month: MONTH_NAMES[d.getMonth()],
    day:   d.getDate(),
    year:  d.getFullYear(),
  };
}

// ─────────────────────────────────────────────────────────────
// Tab config
// ─────────────────────────────────────────────────────────────
type TabId =
  | 'GENERAL' | 'SHIFTS' | 'CALENDAR' | 'LEAVES'
  | 'BRANCHES' | 'DEPARTMENTS' | 'TERMINALS';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'GENERAL',     label: 'General',     icon: 'business-outline' },
  { id: 'SHIFTS',      label: 'Shifts',      icon: 'time-outline' },
  { id: 'CALENDAR',    label: 'Holidays',    icon: 'calendar-outline' },
  { id: 'LEAVES',      label: 'Leaves',      icon: 'umbrella-outline' },
  { id: 'BRANCHES',    label: 'Locations',   icon: 'git-branch-outline' },
  { id: 'DEPARTMENTS', label: 'Departments', icon: 'layers-outline' },
  { id: 'TERMINALS',   label: 'Terminals',   icon: 'scan-outline' },
];

// ─────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────
function SectionLabel({ title }: { title: string }) {
  return <Text style={s.sectionLabel}>{title}</Text>;
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Inp(props: React.ComponentProps<typeof TextInput> & { suffix?: string }) {
  const { suffix, style, ...rest } = props;
  return (
    <View>
      <TextInput style={[s.input, style]} placeholderTextColor="#9CA3AF" {...rest} />
      {suffix && <Text style={s.inputSuffix}>{suffix}</Text>}
    </View>
  );
}

function ToggleRow({
  label, sublabel, value, onValueChange, locked, lockLabel, trackColor,
}: {
  label: string; sublabel?: string; value: boolean;
  onValueChange: (v: boolean) => void;
  locked?: boolean; lockLabel?: string; trackColor?: string;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {sublabel ? <Text style={s.toggleSub}>{sublabel}</Text> : null}
      </View>
      {locked ? (
        <View style={s.lockBadge}>
          <Ionicons name="lock-closed" size={9} color="#7C3AED" />
          <Text style={s.lockBadgeTxt}>{lockLabel ?? 'Pro'}</Text>
        </View>
      ) : (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: '#D1D5DB', true: trackColor ?? '#6366F1' }}
          thumbColor={value ? '#fff' : '#F3F4F6'}
        />
      )}
    </View>
  );
}

function InfoBox({ lines, color = '#4F46E5' }: { lines: string[]; color?: string }) {
  const bg     = color === '#4F46E5' ? '#EEF2FF' : color === '#7C3AED' ? '#F5F3FF' : '#F0FDF4';
  const border = color === '#4F46E5' ? '#C7D2FE' : color === '#7C3AED' ? '#DDD6FE' : '#BBF7D0';
  return (
    <View style={[s.infoBox, { backgroundColor: bg, borderColor: border }]}>
      <Ionicons name="information-circle-outline" size={14} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        {lines.map((l, i) => (
          <Text key={i} style={[s.infoTxt, { color }]}>• {l}</Text>
        ))}
      </View>
    </View>
  );
}

function LockedCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Card style={s.lockedCard}>
      <Ionicons name="lock-closed" size={26} color="#9CA3AF" style={{ marginBottom: 10 }} />
      <Text style={s.lockedTitle}>{title}</Text>
      <Text style={s.lockedSub}>{subtitle}</Text>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline Picker (no native dependency needed)
// ─────────────────────────────────────────────────────────────
function InlinePicker<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable style={s.pickerTrigger} onPress={() => setOpen(true)}>
        <Text style={s.pickerTriggerTxt}>{selected?.label ?? 'Select…'}</Text>
        <Ionicons name="chevron-down" size={14} color="#6B7280" />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setOpen(false)}>
          <View style={s.pickerModal}>
            <Text style={s.pickerModalTitle}>{label}</Text>
            {options.map((opt) => (
              <Pressable
                key={opt.value}
                style={[s.pickerOption, opt.value === value && s.pickerOptionActive]}
                onPress={() => { onChange(opt.value); setOpen(false); }}
              >
                <Text style={[s.pickerOptionTxt, opt.value === value && s.pickerOptionTxtActive]}>
                  {opt.label}
                </Text>
                {opt.value === value && (
                  <Ionicons name="checkmark" size={16} color="#4F46E5" />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// GENERAL TAB
// ─────────────────────────────────────────────────────────────
function GeneralTab({
  settings, setSettings, orgProfile, setOrgProfile, limits,
}: {
  settings: OrgSettings;
  setSettings: (s: OrgSettings) => void;
  orgProfile: { companyName: string; ownerName: string };
  setOrgProfile: (p: { companyName: string; ownerName: string }) => void;
  limits: any;
}) {
  const upd = (patch: Partial<OrgSettings>) => setSettings({ ...settings, ...patch });
  const updCompliance = (patch: any) =>
    setSettings({ ...settings, compliance: { ...(settings.compliance ?? {} as any), ...patch } });

  return (
    <View style={{ gap: 20 }}>
      <SectionLabel title="Organization Profile" />
      <Card>
        <Field label="Company / Site Name">
          <Inp
            value={orgProfile.companyName}
            onChangeText={(v) => setOrgProfile({ ...orgProfile, companyName: v })}
            placeholder="Enter your factory name"
          />
        </Field>
        <View style={{ height: 14 }} />
        <Field label="Admin / Owner Name">
          <Inp
            value={orgProfile.ownerName}
            onChangeText={(v) => setOrgProfile({ ...orgProfile, ownerName: v })}
            placeholder="Your full name"
          />
        </Field>
      </Card>

      <SectionLabel title="Automated Rules" />
      <Card>
        <ToggleRow
          label="Break Tracking"
          sublabel="Auto-deducts 60 mins from daily hours for lunch/rest"
          value={settings.enableBreakTracking ?? false}
          onValueChange={(v) => upd({ enableBreakTracking: v })}
        />
        <View style={s.divider} />
        <ToggleRow
          label="Strict Liveness Detection"
          sublabel="Requires workers to blink at kiosk — prevents proxy punching"
          value={settings.strictLiveness ?? false}
          onValueChange={(v) => upd({ strictLiveness: v })}
          locked={!limits?.livenessDetectionEnabled}
          lockLabel="Pro Feature"
          trackColor="#9333EA"
        />
      </Card>

      <SectionLabel title="Statutory & Compliance" />
      {limits?.statutoryComplianceEnabled ? (
        <Card>
          <View style={s.fieldRow}>
            <View style={{ flex: 1 }}>
              <Field label="PF Registration Number">
                <Inp
                  value={settings.compliance?.pfRegistrationNumber ?? ''}
                  onChangeText={(v) => updCompliance({ pfRegistrationNumber: v })}
                  placeholder="e.g. DLCPM1234567000"
                  autoCapitalize="characters"
                />
              </Field>
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <Field label="ESIC Code">
                <Inp
                  value={settings.compliance?.esicCode ?? ''}
                  onChangeText={(v) => updCompliance({ esicCode: v })}
                  placeholder="17-digit code"
                  keyboardType="numeric"
                />
              </Field>
            </View>
          </View>
          <View style={s.divider} />
          <ToggleRow
            label="Cap PF at Wage Ceiling"
            sublabel="Limits PF contribution to EPF wage ceiling amount"
            value={settings.compliance?.capPfDeduction ?? true}
            onValueChange={(v) => updCompliance({ capPfDeduction: v })}
          />
          <View style={s.divider} />
          <View style={s.fieldRow}>
            <View style={{ flex: 1 }}>
              <Field label="PF Rate (%)">
                <Inp
                  value={String(settings.compliance?.pfContributionRate ?? 12)}
                  onChangeText={(v) => updCompliance({ pfContributionRate: parseFloat(v) || 0 })}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
            <View style={{ width: 10 }} />
            <View style={{ flex: 1 }}>
              <Field label="EPS Rate (%)">
                <Inp
                  value={String(settings.compliance?.epsContributionRate ?? 8.33)}
                  onChangeText={(v) => updCompliance({ epsContributionRate: parseFloat(v) || 0 })}
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
            <View style={{ width: 10 }} />
            <View style={{ flex: 1 }}>
              <Field label="EPF Ceiling (₹)">
                <Inp
                  value={String(settings.compliance?.epfWageCeiling ?? 15000)}
                  onChangeText={(v) => updCompliance({ epfWageCeiling: parseFloat(v) || 0 })}
                  keyboardType="numeric"
                />
              </Field>
            </View>
          </View>
        </Card>
      ) : (
        <LockedCard
          title="Compliance Module Locked"
          subtitle="Automated PF, EPS, ESIC calculations and ECR generation require the Enterprise plan."
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// SHIFTS TAB
// ─────────────────────────────────────────────────────────────
function ShiftsTab({
  settings, setSettings, limits,
}: {
  settings: OrgSettings;
  setSettings: (s: OrgSettings) => void;
  limits: any;
}) {
  const addShift = () => {
    const maxShifts = limits?.maxShifts ?? 1;
    if (settings.shifts.length >= maxShifts) {
      Alert.alert('Plan Limit', `Your plan allows max ${maxShifts} shift(s). Please upgrade.`);
      return;
    }
    const newShift: ShiftConfig = {
      id: `shift_${Date.now()}`, name: 'New Shift',
      startTime: '09:00', endTime: '18:00',
      gracePeriodMins: 15, maxGraceAllowed: 3,
      breakDurationMins: 60, minOvertimeMins: 60, minHalfDayHours: 4,
    };
    setSettings({ ...settings, shifts: [...settings.shifts, newShift] });
  };

  const updateShift = (id: string, patch: Partial<ShiftConfig>) =>
    setSettings({ ...settings, shifts: settings.shifts.map((sh) => sh.id === id ? { ...sh, ...patch } : sh) });

  const removeShift = (id: string) => {
    if (id === 'default') return;
    Alert.alert('Delete Shift', 'Delete this shift?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () =>
          setSettings({ ...settings, shifts: settings.shifts.filter((sh) => sh.id !== id) }) },
    ]);
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={s.tabHeaderRow}>
        <SectionLabel title="Active Shift Profiles" />
        <Pressable style={s.addBtn} onPress={addShift}>
          <Ionicons name="add" size={16} color="#4F46E5" />
          <Text style={s.addBtnTxt}>Add New</Text>
        </Pressable>
      </View>

      {settings.shifts.map((shift) => (
        <Card key={shift.id} style={{ padding: 0, overflow: 'hidden' }}>
          <View style={s.shiftCardHeader}>
            <View style={s.shiftIconWrap}>
              <Ionicons name="time-outline" size={16} color="#4F46E5" />
            </View>
            <TextInput
              style={s.shiftNameInput}
              value={shift.name}
              onChangeText={(v) => updateShift(shift.id, { name: v })}
              editable={shift.id !== 'default'}
              placeholder="Shift name"
              placeholderTextColor="#9CA3AF"
            />
            {shift.id !== 'default' && (
              <Pressable onPress={() => removeShift(shift.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color="#D1D5DB" />
              </Pressable>
            )}
          </View>
          <View style={s.shiftBody}>
            <View style={s.fieldRow}>
              <View style={{ flex: 1 }}>
                <Field label="Start Time">
                  <Inp value={shift.startTime} onChangeText={(v) => updateShift(shift.id, { startTime: v })} placeholder="09:00" keyboardType="numbers-and-punctuation" />
                </Field>
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Field label="End Time">
                  <Inp value={shift.endTime} onChangeText={(v) => updateShift(shift.id, { endTime: v })} placeholder="18:00" keyboardType="numbers-and-punctuation" />
                </Field>
              </View>
            </View>
            <View style={s.fieldRow}>
              <View style={{ flex: 1 }}>
                <Field label="Late Grace (mins)">
                  <Inp value={String(shift.gracePeriodMins ?? '')} onChangeText={(v) => updateShift(shift.id, { gracePeriodMins: parseInt(v) || 0 })} keyboardType="numeric" placeholder="15" />
                </Field>
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Field label="Allowed Late / Month">
                  <Inp value={String(shift.maxGraceAllowed ?? '')} onChangeText={(v) => updateShift(shift.id, { maxGraceAllowed: parseInt(v) || 0 })} keyboardType="numeric" placeholder="3" />
                </Field>
              </View>
            </View>
            <View style={s.otCard}>
              <Field label="Min. Extra Mins to Trigger OT">
                <Inp value={String(shift.minOvertimeMins ?? '')} onChangeText={(v) => updateShift(shift.id, { minOvertimeMins: parseInt(v) || 0 })} keyboardType="numeric" placeholder="60" style={s.inputLight} />
              </Field>
            </View>
          </View>
        </Card>
      ))}

      {settings.shifts.length === 0 && (
        <Card><Text style={s.emptyTxt}>No shifts configured.</Text></Card>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// BRANCHES TAB
// ─────────────────────────────────────────────────────────────
function BranchesTab({
  settings, setSettings, limits,
}: {
  settings: OrgSettings;
  setSettings: (s: OrgSettings) => void;
  limits: any;
}) {
  const [locatingBranchId, setLocatingBranchId] = useState<string | null>(null);
  const branches: Branch[] = settings.branches ?? [];

  const addBranch = () => {
    if (branches.length >= 1 && !limits?.multiBranchEnabled) {
      Alert.alert('Enterprise Plan Required', 'Multiple branches require the Enterprise plan.');
      return;
    }
    setSettings({ ...settings, branches: [...branches, { id: `branch_${Date.now()}`, name: 'New Branch' }] });
  };

  const updateBranchName = (id: string, name: string) =>
    setSettings({ ...settings, branches: branches.map((b) => b.id === id ? { ...b, name } : b) });

  const updateBranchRadius = (id: string, radius: number) =>
    setSettings({
      ...settings,
      branches: branches.map((b) =>
        b.id === id ? { ...b, location: { ...(b.location ?? { lat: 0, lng: 0, address: '' }), radius } } : b,
      ),
    });

  const removeBranch = (id: string) => {
    if (id === 'default') return;
    Alert.alert('Delete Branch', 'Delete this branch?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () =>
          setSettings({ ...settings, branches: branches.filter((b) => b.id !== id) }) },
    ]);
  };

  const handleSetLocation = async (branchId: string) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission required. Enable in device settings.');
      return;
    }
    setLocatingBranchId(branchId);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: lat, longitude: lng } = pos.coords;
      let address = 'Location captured';
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (geo.length > 0) {
          const g = geo[0];
          address = [g.name, g.street, g.city, g.region, g.country].filter(Boolean).join(', ');
        }
      } catch { /* non-fatal */ }
      setSettings({
        ...settings,
        branches: branches.map((b) =>
          b.id === branchId ? { ...b, location: { lat, lng, radius: b.location?.radius ?? 200, address } } : b,
        ),
      });
    } catch (err: any) {
      Alert.alert('Location Error', err?.message ?? 'Unknown error');
    } finally {
      setLocatingBranchId(null);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={s.tabHeaderRow}>
        <SectionLabel title="Factory Locations" />
        <Pressable style={s.addBtn} onPress={addBranch}>
          <Ionicons name="add" size={16} color="#4F46E5" />
          <Text style={s.addBtnTxt}>Add Branch</Text>
        </Pressable>
      </View>

      {branches.map((branch) => (
        <Card key={branch.id} style={{ padding: 0, overflow: 'hidden' }}>
          <View style={s.branchCardHeader}>
            <View style={s.shiftIconWrap}><Ionicons name="business-outline" size={16} color="#4F46E5" /></View>
            <TextInput
              style={s.shiftNameInput}
              value={branch.name}
              onChangeText={(v) => updateBranchName(branch.id, v)}
              editable={branch.id !== 'default'}
              placeholder="Branch / Site Name"
              placeholderTextColor="#9CA3AF"
            />
            {branch.id !== 'default' && (
              <Pressable onPress={() => removeBranch(branch.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color="#D1D5DB" />
              </Pressable>
            )}
          </View>
          <View style={s.branchBody}>
            {limits?.geofencingEnabled !== false ? (
              <>
                {branch.location ? (
                  <View style={s.locationBlock}>
                    <View style={s.locationRow}>
                      <Ionicons name="location" size={15} color="#16A34A" style={{ marginTop: 1 }} />
                      <Text style={s.locationAddress} numberOfLines={2}>{branch.location.address ?? 'Address not found'}</Text>
                    </View>
                    <Text style={s.locationCoords}>Lat: {branch.location.lat.toFixed(6)}  Lng: {branch.location.lng.toFixed(6)}</Text>
                    <View style={s.radiusRow}>
                      <Ionicons name="radio-button-on-outline" size={14} color="#4F46E5" />
                      <Text style={s.radiusLabel}>Enforcement Radius</Text>
                      <TextInput
                        style={s.radiusInput}
                        value={String(branch.location.radius)}
                        onChangeText={(v) => updateBranchRadius(branch.id, parseInt(v) || 200)}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                      <Text style={s.radiusUnit}>m</Text>
                    </View>
                  </View>
                ) : (
                  <View style={s.noLocationWarn}>
                    <Ionicons name="warning-outline" size={14} color="#D97706" />
                    <Text style={s.noLocationTxt}>No location set. All mobile punches will be marked valid.</Text>
                  </View>
                )}
                <Pressable
                  style={[s.setLocBtn, locatingBranchId === branch.id && { opacity: 0.6 }]}
                  onPress={() => handleSetLocation(branch.id)}
                  disabled={locatingBranchId !== null}
                >
                  {locatingBranchId === branch.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="locate-outline" size={15} color="#fff" />
                  }
                  <Text style={s.setLocBtnTxt}>
                    {locatingBranchId === branch.id ? 'Getting location…' : branch.location ? 'Update Location' : 'Set Location'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <View style={s.geoLockedBox}>
                <View style={s.geoLockedHeader}>
                  <View style={[s.shiftIconWrap, { backgroundColor: '#F3F4F6' }]}>
                    <Ionicons name="lock-closed" size={16} color="#9CA3AF" />
                  </View>
                  <Text style={s.geoLockedTitle}>Geofencing</Text>
                  <View style={s.proBadge}><Text style={s.proBadgeTxt}>Pro Feature</Text></View>
                </View>
                <Text style={s.geoLockedSub}>Upgrade to Pro to unlock GPS boundary enforcement.</Text>
              </View>
            )}
          </View>
        </Card>
      ))}

      {branches.length === 0 && (
        <Card><Text style={s.emptyTxt}>No branches. Tap "Add Branch" to get started.</Text></Card>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// DEPARTMENTS TAB
// ─────────────────────────────────────────────────────────────
function DepartmentsTab({ settings, setSettings }: { settings: OrgSettings; setSettings: (s: OrgSettings) => void }) {
  const [newDept, setNewDept] = useState('');

  const addDept = () => {
    const trimmed = newDept.trim();
    if (!trimmed) return;
    const existing = settings.departments ?? [];
    if (existing.includes(trimmed)) { Alert.alert('Duplicate', 'Already exists.'); return; }
    setSettings({ ...settings, departments: [...existing, trimmed] });
    setNewDept('');
  };

  return (
    <View style={{ gap: 16 }}>
      <SectionLabel title="Worker Departments" />
      <Card>
        <View style={s.deptInputRow}>
          <TextInput
            style={s.deptInput}
            value={newDept}
            onChangeText={setNewDept}
            placeholder="e.g. Logistics, Quality Control"
            placeholderTextColor="#9CA3AF"
            returnKeyType="done"
            onSubmitEditing={addDept}
          />
          <Pressable style={s.deptAddBtn} onPress={addDept}>
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={s.chipsWrap}>
          {(settings.departments ?? []).map((d) => (
            <View key={d} style={s.chip}>
              <Text style={s.chipTxt}>{d}</Text>
              <Pressable
                onPress={() => setSettings({ ...settings, departments: (settings.departments ?? []).filter((x) => x !== d) })}
                hitSlop={6} style={{ marginLeft: 6 }}
              >
                <Ionicons name="close" size={13} color="#9CA3AF" />
              </Pressable>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// TERMINALS TAB
// ─────────────────────────────────────────────────────────────
function TerminalsTab({ tenantId, limits }: { tenantId: string; limits: any }) {
  const [terminals, setTerminals]       = useState<KioskTerminal[]>([]);
  const [loadingList, setLoadingList]   = useState(true);
  const [terminalName, setTerminalName] = useState('');
  const [terminalPin, setTerminalPin]   = useState('');
  const [generating, setGenerating]     = useState(false);
  const [revoking, setRevoking]         = useState<string | null>(null);
  const [successCode, setSuccessCode]   = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    dbService.getKioskTerminals(tenantId)
      .then(setTerminals)
      .finally(() => setLoadingList(false));
  }, [tenantId]);

  const handleGenerate = async () => {
    if (!terminalName.trim()) { Alert.alert('Missing Name', 'Enter a terminal name.'); return; }
    if (terminalPin.length !== 4) { Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits.'); return; }
    setGenerating(true);
    setSuccessCode(null);
    try {
      const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
      await dbService.addKioskTerminal({ tenantId, branchId: 'default', name: terminalName.trim(), pairingCode, adminPin: terminalPin, createdAt: new Date().toISOString() });
      const updated = await dbService.getKioskTerminals(tenantId);
      setTerminals(updated);
      setSuccessCode(pairingCode);
      setTerminalName('');
      setTerminalPin('');
    } catch {
      Alert.alert('Error', 'Failed to generate pairing code.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = (terminal: KioskTerminal) => {
    Alert.alert('Revoke Terminal', `Revoke "${terminal.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
          setRevoking(terminal.id);
          try {
            await dbService.deleteKioskTerminal(terminal.id);
            setTerminals((prev) => prev.filter((t) => t.id !== terminal.id));
          } catch { Alert.alert('Error', 'Failed to revoke.'); }
          finally { setRevoking(null); }
        },
      },
    ]);
  };

  if (!limits?.kioskEnabled) {
    return (
      <LockedCard
        title="Kiosk Terminals Locked"
        subtitle="Generating pairing codes for face-scan terminals requires a paid plan. Upgrade to unlock."
      />
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <SectionLabel title="Register New Kiosk" />
      <Card>
        {successCode && (
          <View style={s.successBanner}>
            <View style={s.successBannerLeft}>
              <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
              <View style={{ marginLeft: 10 }}>
                <Text style={s.successBannerTitle}>Terminal Paired!</Text>
                <Text style={s.successBannerSub}>Enter this code on the kiosk device to connect.</Text>
              </View>
            </View>
            <Text style={s.successCode}>{successCode}</Text>
            <Pressable onPress={() => setSuccessCode(null)} hitSlop={8} style={{ marginLeft: 8 }}>
              <Ionicons name="close" size={16} color="#6B7280" />
            </Pressable>
          </View>
        )}

        <View style={s.fieldRow}>
          <View style={{ flex: 1 }}>
            <Field label="Terminal Name">
              <Inp value={terminalName} onChangeText={setTerminalName} placeholder="e.g. Main Gate" />
            </Field>
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Field label="Admin Exit PIN (4 digits)">
              <View>
                <Inp value={terminalPin} onChangeText={(v) => setTerminalPin(v.replace(/\D/g, '').slice(0, 4))} placeholder="····" keyboardType="numeric" maxLength={4} secureTextEntry style={s.pinInput} />
                <Ionicons name="lock-closed" size={14} color="#9CA3AF" style={s.pinIcon} />
              </View>
            </Field>
          </View>
        </View>

        <Pressable
          style={[s.generateBtn, (generating || !terminalName.trim() || terminalPin.length !== 4) && { opacity: 0.5 }]}
          onPress={handleGenerate}
          disabled={generating || !terminalName.trim() || terminalPin.length !== 4}
        >
          {generating ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="scan-outline" size={16} color="#fff" />}
          <Text style={s.generateBtnTxt}>{generating ? 'Generating…' : 'Generate Pairing Code'}</Text>
        </Pressable>
      </Card>

      <SectionLabel title="Active Terminals" />
      {loadingList ? (
        <Card><ActivityIndicator size="small" color="#7C3AED" style={{ paddingVertical: 16 }} /></Card>
      ) : terminals.length === 0 ? (
        <Card>
          <View style={s.emptyTerminals}>
            <Ionicons name="tablet-portrait-outline" size={36} color="#E5E7EB" />
            <Text style={s.emptyTerminalsTxt}>No active terminals.</Text>
          </View>
        </Card>
      ) : (
        terminals.map((terminal) => (
          <Card key={terminal.id} style={s.terminalCard}>
            <View style={s.terminalCardLeft}>
              <View style={s.terminalIconWrap}><Ionicons name="tablet-portrait-outline" size={20} color="#7C3AED" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.terminalName}>{terminal.name}</Text>
                <Text style={s.terminalCreated}>Added {new Date(terminal.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                <View style={s.pairingCodeWrap}>
                  <Text style={s.pairingCodeLabel}>Pairing Code</Text>
                  <Text style={s.pairingCode}>{terminal.pairingCode}</Text>
                </View>
              </View>
            </View>
            <Pressable style={[s.revokeBtn, revoking === terminal.id && { opacity: 0.5 }]} onPress={() => handleRevoke(terminal)} disabled={revoking !== null} hitSlop={4}>
              {revoking === terminal.id ? <ActivityIndicator size="small" color="#EF4444" /> : <Ionicons name="trash-outline" size={18} color="#EF4444" />}
            </Pressable>
          </Card>
        ))
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// CALENDAR TAB
// ─────────────────────────────────────────────────────────────
function CalendarTab({
  settings, setSettings, limits,
}: {
  settings: OrgSettings;
  setSettings: (s: OrgSettings) => void;
  limits: any;
}) {
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayPaid, setNewHolidayPaid] = useState<'PAID' | 'UNPAID'>('PAID');

  const weeklyOffs: WeeklyOffConfig = settings.weeklyOffs ?? { defaultDays: [0], saturdayRule: 'NONE' };
  const holidays: Holiday[] = (settings.holidays ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const satSelected = weeklyOffs.defaultDays.includes(6);

  const toggleDay = (day: number) => {
    const current = weeklyOffs.defaultDays;
    const updated  = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    setSettings({ ...settings, weeklyOffs: { ...weeklyOffs, defaultDays: updated } });
  };

  const setSatRule = (rule: SaturdayOffType) =>
    setSettings({ ...settings, weeklyOffs: { ...weeklyOffs, saturdayRule: rule } });

  const addHoliday = () => {
    if (!newHolidayName.trim()) {
      Alert.alert('Missing Name', 'Please enter a holiday name.');
      return;
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(newHolidayDate)) {
      Alert.alert('Invalid Date', 'Enter date in YYYY-MM-DD format (e.g. 2026-01-26).');
      return;
    }
    const newH: Holiday = {
      id:     `holiday_${Date.now()}`,
      name:   newHolidayName.trim(),
      date:   newHolidayDate,
      isPaid: newHolidayPaid === 'PAID',
    };
    setSettings({ ...settings, holidays: [...(settings.holidays ?? []), newH] });
    setNewHolidayName('');
    setNewHolidayDate('');
    setNewHolidayPaid('PAID');
  };

  const deleteHoliday = (id: string) =>
    setSettings({ ...settings, holidays: (settings.holidays ?? []).filter((h) => h.id !== id) });

  return (
    <View style={{ gap: 20 }}>
      <SectionLabel title="Weekly Offs" />
      <Card>
        <Text style={s.cardSubtitle}>Select which days are automatically marked as weekly off.</Text>
        <View style={s.dayRow}>
          {DAYS.map((d) => {
            const active = weeklyOffs.defaultDays.includes(d.value);
            return (
              <Pressable
                key={d.value}
                style={[s.dayBtn, active && s.dayBtnActive]}
                onPress={() => toggleDay(d.value)}
              >
                <Text style={[s.dayBtnTxt, active && s.dayBtnTxtActive]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {satSelected && (
          <>
            <View style={s.divider} />
            <InlinePicker<SaturdayOffType>
              label="Saturday Rule"
              value={weeklyOffs.saturdayRule ?? 'ALL'}
              options={SATURDAY_RULES}
              onChange={setSatRule}
            />
            <InfoBox
              lines={[
                '"Alternate (2nd & 4th)" — 2nd and 4th Saturdays of each month are off.',
                '"1st & 3rd Off" — 1st and 3rd Saturdays are off.',
                '"All Saturdays Off" — every Saturday is a weekly off.',
              ]}
            />
          </>
        )}
      </Card>

      <SectionLabel title="Payroll Rules" />
      <Card>
        <ToggleRow
          label="Sandwich Rule"
          sublabel='If absent before AND after a holiday, the holiday becomes Unpaid.'
          value={settings.enableSandwichRule ?? false}
          onValueChange={(v) => setSettings({ ...settings, enableSandwichRule: v })}
          locked={!limits?.advancedLeavesEnabled}
          lockLabel="Pro Feature"
          trackColor="#9333EA"
        />
        <View style={s.divider} />
        <Field label="Holiday Pay Multiplier">
          <View style={s.multiplierRow}>
            <Pressable
              style={s.stepBtn}
              onPress={() => {
                const cur = settings.holidayPayMultiplier ?? 2.0;
                const next = Math.max(1.0, parseFloat((cur - 0.5).toFixed(1)));
                setSettings({ ...settings, holidayPayMultiplier: next });
              }}
            >
              <Ionicons name="remove" size={16} color="#4F46E5" />
            </Pressable>
            <View style={s.multiplierDisplay}>
              <Text style={s.multiplierValue}>{(settings.holidayPayMultiplier ?? 2.0).toFixed(1)}</Text>
              <Text style={s.multiplierUnit}>×</Text>
            </View>
            <Pressable
              style={s.stepBtn}
              onPress={() => {
                const cur = settings.holidayPayMultiplier ?? 2.0;
                const next = Math.min(4.0, parseFloat((cur + 0.5).toFixed(1)));
                setSettings({ ...settings, holidayPayMultiplier: next });
              }}
            >
              <Ionicons name="add" size={16} color="#4F46E5" />
            </Pressable>
            <Text style={s.multiplierHint}>
              Workers who work on holidays earn {(settings.holidayPayMultiplier ?? 2.0).toFixed(1)}× their
              daily wage.
            </Text>
          </View>
        </Field>
      </Card>

      <SectionLabel title="Public Holidays" />
      {limits?.publicHolidaysEnabled ? (
        <>
          <Card>
            <Text style={s.cardSubtitle}>Add national/regional holidays to auto-mark on muster.</Text>
            <Field label="Holiday Name">
              <Inp
                value={newHolidayName}
                onChangeText={setNewHolidayName}
                placeholder="e.g. Republic Day, Diwali"
              />
            </Field>
            <View style={{ height: 12 }} />
            <View style={s.fieldRow}>
              <View style={{ flex: 1 }}>
                <Field label="Date (YYYY-MM-DD)">
                  <Inp
                    value={newHolidayDate}
                    onChangeText={setNewHolidayDate}
                    placeholder="2026-01-26"
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                </Field>
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <InlinePicker
                  label="Pay Type"
                  value={newHolidayPaid}
                  options={[
                    { label: '✅ Paid Holiday',   value: 'PAID' },
                    { label: '🚫 Unpaid Holiday', value: 'UNPAID' },
                  ]}
                  onChange={(v) => setNewHolidayPaid(v as 'PAID' | 'UNPAID')}
                />
              </View>
            </View>
            <Pressable
              style={[s.addHolidayBtn, (!newHolidayName.trim() || !newHolidayDate) && { opacity: 0.5 }]}
              onPress={addHoliday}
              disabled={!newHolidayName.trim() || !newHolidayDate}
            >
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={s.addHolidayBtnTxt}>Add Holiday</Text>
            </Pressable>
          </Card>

          {holidays.length > 0 && (
            <View style={{ gap: 8 }}>
              {holidays.map((h) => {
                const { month, day } = formatHolidayDate(h.date);
                return (
                  <View key={h.id} style={s.holidayRow}>
                    <View style={s.holidayDateChip}>
                      <Text style={s.holidayMonth}>{month}</Text>
                      <Text style={s.holidayDay}>{day}</Text>
                    </View>
                    <Text style={s.holidayName} numberOfLines={1}>{h.name}</Text>
                    <View style={[s.holidayBadge, h.isPaid ? s.holidayBadgePaid : s.holidayBadgeUnpaid]}>
                      <Text style={[s.holidayBadgeTxt, h.isPaid ? s.holidayBadgeTxtPaid : s.holidayBadgeTxtUnpaid]}>
                        {h.isPaid ? 'Paid' : 'Unpaid'}
                      </Text>
                    </View>
                    <Pressable onPress={() => deleteHoliday(h.id)} hitSlop={8} style={s.holidayDeleteBtn}>
                      <Ionicons name="trash-outline" size={15} color="#EF4444" />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {holidays.length === 0 && (
            <Card>
              <View style={s.emptyTerminals}>
                <Ionicons name="calendar-outline" size={36} color="#E5E7EB" />
                <Text style={s.emptyTerminalsTxt}>No public holidays added yet.</Text>
                <Text style={s.emptyTerminalsSub}>Add national/regional holidays using the form above.</Text>
              </View>
            </Card>
          )}
        </>
      ) : (
        <LockedCard
          title="Public Holidays Locked"
          subtitle="Configuring paid/unpaid public holidays for auto-muster marking requires the Starter plan or above."
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// LEAVES TAB
// ─────────────────────────────────────────────────────────────
function LeavesTab({
  settings, setSettings, limits,
}: {
  settings: OrgSettings;
  setSettings: (s: OrgSettings) => void;
  limits: any;
}) {
  const policy: LeavePolicy = settings.leavePolicy ?? {
    cl: 12, sl: 6, pl: 15, allowNegativeBalance: false,
  };

  const updPolicy = (patch: Partial<LeavePolicy>) =>
    setSettings({ ...settings, leavePolicy: { ...policy, ...patch } });

  if (!limits?.advancedLeavesEnabled) {
    return (
      <LockedCard
        title="Leave Policy Locked"
        subtitle="Configuring CL / SL / PL quotas, sandwich rule, and LWP auto-conversion requires the Pro plan or above."
      />
    );
  }

  return (
    <View style={{ gap: 20 }}>
      <SectionLabel title="Annual Leave Quotas" />
      <Card>
        <Text style={s.cardSubtitle}>
          Set the annual leave entitlements for all workers. Balances reset each calendar year.
        </Text>

        <View style={s.fieldRow}>
          {/* CL */}
          <View style={[s.leaveQuotaBox, { borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' }]}>
            <View style={[s.leaveQuotaIcon, { backgroundColor: '#DBEAFE' }]}>
              <Text style={s.leaveQuotaEmoji}>📋</Text>
            </View>
            <Text style={s.leaveQuotaType}>CL</Text>
            <Text style={s.leaveQuotaFull}>Casual</Text>
            <TextInput
              style={s.leaveQuotaInput}
              value={String(policy.cl)}
              onChangeText={(v) => updPolicy({ cl: parseInt(v) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              selectTextOnFocus
            />
            <Text style={s.leaveQuotaDays}>days/yr</Text>
          </View>

          <View style={{ width: 10 }} />

          {/* SL */}
          <View style={[s.leaveQuotaBox, { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }]}>
            <View style={[s.leaveQuotaIcon, { backgroundColor: '#DCFCE7' }]}>
              <Text style={s.leaveQuotaEmoji}>🏥</Text>
            </View>
            <Text style={[s.leaveQuotaType, { color: '#16A34A' }]}>SL</Text>
            <Text style={s.leaveQuotaFull}>Sick</Text>
            <TextInput
              style={[s.leaveQuotaInput, { borderColor: '#86EFAC', color: '#16A34A' }]}
              value={String(policy.sl)}
              onChangeText={(v) => updPolicy({ sl: parseInt(v) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              selectTextOnFocus
            />
            <Text style={[s.leaveQuotaDays, { color: '#16A34A' }]}>days/yr</Text>
          </View>

          <View style={{ width: 10 }} />

          {/* PL */}
          <View style={[s.leaveQuotaBox, { borderColor: '#DDD6FE', backgroundColor: '#F5F3FF' }]}>
            <View style={[s.leaveQuotaIcon, { backgroundColor: '#EDE9FE' }]}>
              <Text style={s.leaveQuotaEmoji}>⭐</Text>
            </View>
            <Text style={[s.leaveQuotaType, { color: '#7C3AED' }]}>PL</Text>
            <Text style={s.leaveQuotaFull}>Privilege</Text>
            <TextInput
              style={[s.leaveQuotaInput, { borderColor: '#C4B5FD', color: '#7C3AED' }]}
              value={String(policy.pl)}
              onChangeText={(v) => updPolicy({ pl: parseInt(v) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              selectTextOnFocus
            />
            <Text style={[s.leaveQuotaDays, { color: '#7C3AED' }]}>days/yr</Text>
          </View>
        </View>

        <View style={[s.infoBox, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA', marginTop: 14 }]}>
          <Ionicons name="bulb-outline" size={14} color="#C2410C" style={{ marginTop: 1 }} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[s.infoTxt, { color: '#C2410C' }]}>
              • CL: unplanned short absences. Usually non-carry-forward.
            </Text>
            <Text style={[s.infoTxt, { color: '#C2410C' }]}>
              • SL: medical/health-related leaves, requires medical proof above 3 days.
            </Text>
            <Text style={[s.infoTxt, { color: '#C2410C' }]}>
              • PL / EL: earned over service, typically carry-forward eligible.
            </Text>
          </View>
        </View>
      </Card>

      <SectionLabel title="Leave Encashment Rules" />
      <Card>
        <ToggleRow
          label="Allow Negative Leave Balance"
          sublabel="If OFF — excess leaves are auto-converted to LWP (Leave Without Pay) and deducted from salary."
          value={policy.allowNegativeBalance}
          onValueChange={(v) => updPolicy({ allowNegativeBalance: v })}
          trackColor="#9333EA"
        />
        {!policy.allowNegativeBalance && (
          <InfoBox
            color="#7C3AED"
            lines={[
              'Worker takes 14 CL but quota is 12 → extra 2 days = 2 LWP.',
              'LWP days are deducted proportionally from gross monthly salary.',
              'LWP is visible in payslip and monthly payroll summary.',
            ]}
          />
        )}
      </Card>

      <Card style={[s.leaveSummaryCard]}>
        <Text style={s.leaveSummaryTitle}>Leave Budget per Worker</Text>
        <View style={s.leaveSummaryRow}>
          <View style={s.leaveSummaryItem}>
            <Text style={s.leaveSummaryNum}>{policy.cl}</Text>
            <Text style={s.leaveSummaryLabel}>Casual</Text>
          </View>
          <View style={s.leaveSummaryDivider} />
          <View style={s.leaveSummaryItem}>
            <Text style={[s.leaveSummaryNum, { color: '#16A34A' }]}>{policy.sl}</Text>
            <Text style={s.leaveSummaryLabel}>Sick</Text>
          </View>
          <View style={s.leaveSummaryDivider} />
          <View style={s.leaveSummaryItem}>
            <Text style={[s.leaveSummaryNum, { color: '#7C3AED' }]}>{policy.pl}</Text>
            <Text style={s.leaveSummaryLabel}>Privilege</Text>
          </View>
          <View style={s.leaveSummaryDivider} />
          <View style={s.leaveSummaryItem}>
            <Text style={[s.leaveSummaryNum, { color: '#111827' }]}>{policy.cl + policy.sl + policy.pl}</Text>
            <Text style={s.leaveSummaryLabel}>Total</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN SettingsScreen
// ─────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { profile, limits } = useAuth();

  const [activeTab, setActiveTab]             = useState<TabId>('GENERAL');
  const [settings, setSettings]               = useState<OrgSettings | null>(null);
  const [initialSettings, setInitialSettings] = useState<OrgSettings | null>(null);
  const [orgProfile, setOrgProfile]           = useState({ companyName: '', ownerName: '' });
  const [initOrgProfile, setInitOrgProfile]   = useState({ companyName: '', ownerName: '' });
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);
  const [toast, setToast]                     = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const saveBtnAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!profile?.tenantId) return;
    const orgP = { companyName: profile.companyName ?? '', ownerName: (profile as any).name ?? profile.email ?? '' };
    setOrgProfile(orgP);
    setInitOrgProfile(orgP);
    dbService.getOrgSettings(profile.tenantId)
      .then((data) => { setSettings(data); setInitialSettings(data); })
      .finally(() => setLoading(false));
  }, [profile?.tenantId]);

  const hasChanges =
    JSON.stringify(settings) !== JSON.stringify(initialSettings) ||
    JSON.stringify(orgProfile) !== JSON.stringify(initOrgProfile);

  useEffect(() => {
    Animated.spring(saveBtnAnim, {
      toValue: hasChanges ? 1 : 0,
      useNativeDriver: true,
      tension: 80, friction: 10,
    }).start();
  }, [hasChanges]);

  const saveBtnTranslate = saveBtnAnim.interpolate({
    inputRange: [0, 1], outputRange: [120, 0],
  });

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = useCallback(async () => {
    if (!profile || !settings) return;
    setSaving(true);
    try {
      if (profile.tenantId) {
        await dbService.saveOrgSettings(profile.tenantId, settings);
        setInitialSettings(settings);
      }
      if (JSON.stringify(orgProfile) !== JSON.stringify(initOrgProfile)) {
        await updateDoc(doc(getFirestore(), 'users', profile.uid), {
          companyName: orgProfile.companyName,
          name:        orgProfile.ownerName,
        });
        setInitOrgProfile(orgProfile);
      }
      showToast('ok', 'Changes saved successfully!');
    } catch (e) {
      console.error('Settings save error:', e);
      showToast('err', 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }, [profile, settings, orgProfile, initOrgProfile]);

  const handleDiscard = () => { setSettings(initialSettings); setOrgProfile(initOrgProfile); };

  if (loading || !settings) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Factory Settings</Text>
          <Text style={s.headerSub}>Manage your organization & rules</Text>
        </View>

        {/* Toast */}
        {toast && (
          <Animated.View style={[s.toastBar, { backgroundColor: toast.type === 'ok' ? '#16A34A' : '#DC2626' }]}>
            <Ionicons name={toast.type === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={16} color="#fff" />
            <Text style={s.toastTxt}>{toast.msg}</Text>
          </Animated.View>
        )}

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabBarContent} style={s.tabBar}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Pressable key={tab.id} style={[s.tabPill, active && s.tabPillActive]} onPress={() => setActiveTab(tab.id)}>
                <Ionicons name={tab.icon as any} size={14} color={active ? '#fff' : '#6B7280'} />
                <Text style={[s.tabPillTxt, active && s.tabPillTxtActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Tab content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {activeTab === 'GENERAL' && (
            <GeneralTab settings={settings} setSettings={setSettings} orgProfile={orgProfile} setOrgProfile={setOrgProfile} limits={limits} />
          )}
          {activeTab === 'SHIFTS' && (
            <ShiftsTab settings={settings} setSettings={setSettings} limits={limits} />
          )}
          {activeTab === 'CALENDAR' && (
            <CalendarTab settings={settings} setSettings={setSettings} limits={limits} />
          )}
          {activeTab === 'LEAVES' && (
            <LeavesTab settings={settings} setSettings={setSettings} limits={limits} />
          )}
          {activeTab === 'BRANCHES' && (
            <BranchesTab settings={settings} setSettings={setSettings} limits={limits} />
          )}
          {activeTab === 'DEPARTMENTS' && (
            <DepartmentsTab settings={settings} setSettings={setSettings} />
          )}
          {activeTab === 'TERMINALS' && profile?.tenantId && (
            <TerminalsTab tenantId={profile.tenantId} limits={limits} />
          )}
        </ScrollView>

        {/* Floating save bar */}
        {activeTab !== 'TERMINALS' && (
          <Animated.View style={[s.saveBar, { transform: [{ translateY: saveBtnTranslate }] }]}>
            <View style={s.saveBarLeft}>
              <Ionicons name="warning-outline" size={16} color="#FBBF24" />
              <Text style={s.saveBarTxt}>Unsaved changes</Text>
            </View>
            <View style={s.saveBarRight}>
              <Pressable onPress={handleDiscard} style={s.discardBtn} disabled={saving}>
                <Text style={s.discardBtnTxt}>Discard</Text>
              </Pressable>
              <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="save-outline" size={14} color="#fff" />}
                <Text style={s.saveBtnTxt}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#F9FAFB' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB' },

  header:      { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#111827' },
  headerSub:   { fontSize: 12, color: '#6B7280', marginTop: 2 },

  toastBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 12 },
  toastTxt: { color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 },

  tabBar:           { maxHeight: 52, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tabBarContent:    { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: 'row' },
  tabPill:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  tabPillActive:    { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  tabPillTxt:       { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  tabPillTxtActive: { color: '#fff' },

  scrollContent: { padding: 16, paddingBottom: 130 },

  sectionLabel: { fontSize: 10, fontWeight: '900', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: -4 },

  card:         { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardSubtitle: { fontSize: 12, color: '#6B7280', marginBottom: 14 },

  field:      { gap: 5 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldRow:   { flexDirection: 'row', alignItems: 'flex-start' },
  input:      { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#F9FAFB' },
  inputLight: { backgroundColor: '#fff', borderColor: '#BFDBFE' },
  inputSuffix:{ position: 'absolute', right: 10, top: 10, fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  inputWithHint: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hintTxt:    { flex: 1, fontSize: 11, color: '#6B7280', lineHeight: 15 },

  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel:  { fontSize: 13, fontWeight: '800', color: '#111827' },
  toggleSub:    { fontSize: 11, color: '#6B7280', marginTop: 2 },
  lockBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EDE9FE', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  lockBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#7C3AED', textTransform: 'uppercase' },

  infoBox: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 12 },
  infoTxt: { fontSize: 11, lineHeight: 17, marginBottom: 2 },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 14 },

  lockedCard:  { alignItems: 'center', backgroundColor: '#F9FAFB', borderStyle: 'dashed', padding: 28 },
  lockedTitle: { fontSize: 14, fontWeight: '800', color: '#374151', marginBottom: 6 },
  lockedSub:   { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },

  tabHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EEF2FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnTxt:    { color: '#4F46E5', fontSize: 12, fontWeight: '700' },

  shiftCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FAFAFA', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  shiftIconWrap:   { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  shiftNameInput:  { flex: 1, fontSize: 15, fontWeight: '800', color: '#111827' },
  shiftBody:       { padding: 14, gap: 14 },
  otCard:          { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#BFDBFE', gap: 8 },
  emptyTxt:        { fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingVertical: 20 },

  branchCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FAFAFA', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  branchBody:       { padding: 14, gap: 12 },
  locationBlock:    { backgroundColor: '#F0FDF4', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#BBF7D0', gap: 8 },
  locationRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  locationAddress:  { flex: 1, fontSize: 13, color: '#111827', fontWeight: '600', lineHeight: 18 },
  locationCoords:   { fontSize: 11, color: '#6B7280', fontFamily: MONO, marginLeft: 21 },
  radiusRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  radiusLabel:      { flex: 1, fontSize: 11, color: '#374151', fontWeight: '700' },
  radiusInput:      { width: 64, borderWidth: 1, borderColor: '#C7D2FE', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, color: '#4F46E5', fontWeight: '800', textAlign: 'center', backgroundColor: '#fff' },
  radiusUnit:       { fontSize: 11, color: '#4F46E5', fontWeight: '700' },
  noLocationWarn:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#FDE68A' },
  noLocationTxt:    { flex: 1, fontSize: 11, color: '#D97706', lineHeight: 16 },
  setLocBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#16A34A', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginTop: 4 },
  setLocBtnTxt:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  geoLockedBox:     { backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  geoLockedHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  geoLockedTitle:   { flex: 1, fontSize: 13, fontWeight: '800', color: '#374151' },
  geoLockedSub:     { fontSize: 11, color: '#9CA3AF', lineHeight: 17 },
  proBadge:         { backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  proBadgeTxt:      { fontSize: 9, fontWeight: '900', color: '#D97706', textTransform: 'uppercase' },
  warnBanner:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#FDE68A' },
  warnBannerTxt:    { flex: 1, fontSize: 12, color: '#92400E', lineHeight: 17 },

  deptInputRow: { flexDirection: 'row', gap: 0, marginBottom: 16 },
  deptInput:    { flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRightWidth: 0, borderTopLeftRadius: 12, borderBottomLeftRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#F9FAFB' },
  deptAddBtn:   { backgroundColor: '#4F46E5', borderTopRightRadius: 12, borderBottomRightRadius: 12, width: 46, alignItems: 'center', justifyContent: 'center' },
  chipsWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  chipTxt:      { fontSize: 13, fontWeight: '700', color: '#374151' },

  pinInput:   { letterSpacing: 8, fontFamily: MONO, fontSize: 16, fontWeight: '800' },
  pinIcon:    { position: 'absolute', right: 12, top: 12 },
  generateBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20, marginTop: 8, shadowColor: '#7C3AED', shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  generateBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  successBanner:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4', borderWidth: 1.5, borderColor: '#86EFAC', borderRadius: 14, padding: 12, marginBottom: 16, gap: 8 },
  successBannerLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center' },
  successBannerTitle: { fontSize: 13, fontWeight: '800', color: '#15803D' },
  successBannerSub:   { fontSize: 11, color: '#16A34A', marginTop: 1 },
  successCode:        { fontSize: 22, fontWeight: '900', color: '#7C3AED', fontFamily: MONO, letterSpacing: 4 },
  terminalCard:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  terminalCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  terminalIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE', alignItems: 'center', justifyContent: 'center' },
  terminalName:     { fontSize: 15, fontWeight: '800', color: '#111827' },
  terminalCreated:  { fontSize: 11, color: '#9CA3AF', marginTop: 1, marginBottom: 6 },
  pairingCodeWrap:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F5F3FF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  pairingCodeLabel: { fontSize: 9, fontWeight: '900', color: '#7C3AED', textTransform: 'uppercase', letterSpacing: 0.5 },
  pairingCode:      { fontSize: 18, fontWeight: '900', color: '#6D28D9', fontFamily: MONO, letterSpacing: 3 },
  revokeBtn:        { width: 38, height: 38, borderRadius: 10, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', alignItems: 'center', justifyContent: 'center' },
  emptyTerminals:    { alignItems: 'center', paddingVertical: 28, gap: 6 },
  emptyTerminalsTxt: { fontSize: 13, fontWeight: '700', color: '#9CA3AF' },
  emptyTerminalsSub: { fontSize: 11, color: '#D1D5DB' },

  // Calendar
  dayRow:      { flexDirection: 'row', gap: 6, marginBottom: 4 },
  dayBtn:      { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  dayBtnActive:{ backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  dayBtnTxt:   { fontSize: 11, fontWeight: '800', color: '#6B7280' },
  dayBtnTxtActive: { color: '#fff' },

  pickerTrigger:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F9FAFB', marginTop: 5 },
  pickerTriggerTxt: { fontSize: 14, color: '#111827', flex: 1 },
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerModal:      { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 380, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 20 },
  pickerModalTitle: { fontSize: 14, fontWeight: '900', color: '#111827', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  pickerOption:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4 },
  pickerOptionActive: { backgroundColor: '#EEF2FF' },
  pickerOptionTxt:    { fontSize: 14, color: '#374151' },
  pickerOptionTxtActive: { color: '#4F46E5', fontWeight: '800' },

  multiplierRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 },
  stepBtn:          { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE', alignItems: 'center', justifyContent: 'center' },
  multiplierDisplay:{ flexDirection: 'row', alignItems: 'baseline', gap: 2, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  multiplierValue:  { fontSize: 20, fontWeight: '900', color: '#4F46E5' },
  multiplierUnit:   { fontSize: 14, fontWeight: '800', color: '#6B7280' },
  multiplierHint:   { flex: 1, fontSize: 11, color: '#6B7280', lineHeight: 16 },

  addHolidayBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4F46E5', borderRadius: 12, paddingVertical: 11, marginTop: 14 },
  addHolidayBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  holidayRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1 },
  holidayDateChip:   { width: 46, alignItems: 'center', backgroundColor: '#EEF2FF', borderRadius: 12, paddingVertical: 6 },
  holidayMonth:      { fontSize: 9, fontWeight: '900', color: '#6366F1', textTransform: 'uppercase' },
  holidayDay:        { fontSize: 20, fontWeight: '900', color: '#4F46E5', lineHeight: 24 },
  holidayName:       { flex: 1, fontSize: 13, fontWeight: '700', color: '#111827' },
  holidayBadge:      { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  holidayBadgePaid:      { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  holidayBadgeUnpaid:    { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  holidayBadgeTxt:       { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  holidayBadgeTxtPaid:   { color: '#16A34A' },
  holidayBadgeTxtUnpaid: { color: '#D97706' },
  holidayDeleteBtn:      { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center' },

  // Leaves
  leaveQuotaBox:   { flex: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  leaveQuotaIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  leaveQuotaEmoji: { fontSize: 18 },
  leaveQuotaType:  { fontSize: 16, fontWeight: '900', color: '#3B82F6' },
  leaveQuotaFull:  { fontSize: 9, color: '#9CA3AF', fontWeight: '700', textTransform: 'uppercase' },
  leaveQuotaInput: { width: '100%', borderWidth: 1.5, borderColor: '#BFDBFE', borderRadius: 10, paddingVertical: 8, fontSize: 22, fontWeight: '900', color: '#3B82F6', textAlign: 'center', backgroundColor: '#fff', marginTop: 4 },
  leaveQuotaDays:  { fontSize: 10, color: '#6B7280', fontWeight: '700' },

  leaveSummaryCard:    { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  leaveSummaryTitle:   { fontSize: 10, fontWeight: '900', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  leaveSummaryRow:     { flexDirection: 'row', alignItems: 'center' },
  leaveSummaryItem:    { flex: 1, alignItems: 'center' },
  leaveSummaryNum:     { fontSize: 28, fontWeight: '900', color: '#3B82F6' },
  leaveSummaryLabel:   { fontSize: 10, color: '#9CA3AF', fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  leaveSummaryDivider: { width: 1, height: 40, backgroundColor: '#E5E7EB' },

  saveBar:      { position: 'absolute', bottom: 16, left: 16, right: 16, backgroundColor: '#1F2937', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 12 },
  saveBarLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveBarTxt:   { color: '#fff', fontSize: 13, fontWeight: '700' },
  saveBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  discardBtn:   { paddingHorizontal: 10, paddingVertical: 6 },
  discardBtnTxt:{ color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
  saveBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnTxt:   { color: '#fff', fontSize: 13, fontWeight: '800' },
});
