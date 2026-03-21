// app/(admin)/reports.tsx
// Fixed for expo-file-system v18+ (SDK 54)
// Legacy API moved to 'expo-file-system/legacy'
// New API: import { File, Paths } from 'expo-file-system'

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  SectionList, Platform, Alert, Modal, TextInput,
  KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart } from 'react-native-gifted-charts';

// ✅ CORRECT import for expo-file-system v18+ (SDK 54)
import { File, Paths } from 'expo-file-system';
// ✅ Legacy API still available under /legacy for writeAsStringAsync if needed
import * as Sharing from 'expo-sharing';

import { useAuth } from './../../src/contexts/AuthContext';
import { dbService } from './../../src/services/db';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface WorkerRow {
  id:                 string;
  name:               string;
  designation:        string;
  present:            number;
  absent:             number;
  late:               number;
  otHours:            number;
  geofenceViolations: number;
  dailyWage:          number;
}

interface DailyBarItem {
  value:      number;
  label:      string;
  frontColor: string;
}

type Preset = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

// ─────────────────────────────────────────────────────────────
// File write helper — works on native using new File API
// ─────────────────────────────────────────────────────────────
async function writeFileNative(fileName: string, content: string): Promise<string> {
  const file = new File(Paths.document, fileName);
  // If file already exists from previous export, delete first
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(content);
  return file.uri;
}

// ─────────────────────────────────────────────────────────────
// Web download helper
// ─────────────────────────────────────────────────────────────
function downloadOnWeb(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────
const pad    = (n: number) => String(n).padStart(2, '0');
const toISO  = (d: Date)   => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function getPresetRange(preset: Preset, customStart: string, customEnd: string) {
  const today = new Date();
  if (preset === 'TODAY') { const s = toISO(today); return { start: s, end: s }; }
  if (preset === 'WEEK') {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - ((dow + 6) % 7));
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    return { start: toISO(mon), end: toISO(sun) };
  }
  if (preset === 'MONTH') {
    const y = today.getFullYear(), m = today.getMonth();
    return { start: toISO(new Date(y, m, 1)), end: toISO(new Date(y, m + 1, 0)) };
  }
  return { start: customStart, end: customEnd };
}

function eachDayInRange(start: string, end: string): string[] {
  const result: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const fin = new Date(end   + 'T00:00:00');
  while (cur <= fin) { result.push(toISO(cur)); cur.setDate(cur.getDate() + 1); }
  return result;
}

const dayLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

// ─────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────
function KpiCard({ icon, iconBg, iconColor, label, value }: {
  icon: string; iconBg: string; iconColor: string;
  label: string; value: string | number;
}) {
  return (
    <View style={[s.kpiCard, { borderTopColor: iconColor, borderTopWidth: 3 }]}>
      <View style={[s.kpiIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title, icon, color }: { title: string; icon: string; color: string }) {
  return (
    <View style={s.sectionHeaderRow}>
      <View style={[s.sectionHeaderIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <Text style={[s.sectionHeaderTxt, { color }]}>{title}</Text>
    </View>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <View style={s.emptySection}>
      <Ionicons name="albums-outline" size={28} color="#E5E7EB" />
      <Text style={s.emptySectionTxt}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Date range modal (zero native deps)
// ─────────────────────────────────────────────────────────────
function DateRangeModal({ visible, start, end, onConfirm, onClose }: {
  visible: boolean; start: string; end: string;
  onConfirm: (s: string, e: string) => void; onClose: () => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  useEffect(() => { if (visible) { setS(start); setE(end); } }, [visible]);

  const confirm = () => {
    if (!s || !e)  { Alert.alert('Missing Date', 'Enter both start and end dates.'); return; }
    if (s > e)     { Alert.alert('Invalid Range', 'Start must be before end.'); return; }
    const diffDays = (new Date(e).getTime() - new Date(s).getTime()) / 86400000;
    if (diffDays > 90) { Alert.alert('Too Wide', 'Max range is 90 days.'); return; }
    onConfirm(s, e);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={ms.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={ms.modal}>
            <Text style={ms.modalTitle}>Custom Date Range</Text>
            <Text style={ms.dateLabel}>Start Date</Text>
            <TextInput style={ms.dateInput} value={s} onChangeText={setS}
              placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF"
              keyboardType="numbers-and-punctuation" maxLength={10} />
            <Text style={ms.dateLabel}>End Date</Text>
            <TextInput style={ms.dateInput} value={e} onChangeText={setE}
              placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF"
              keyboardType="numbers-and-punctuation" maxLength={10} />
            <View style={ms.modalBtns}>
              <Pressable style={ms.cancelBtn}  onPress={onClose}>
                <Text style={ms.cancelBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable style={ms.confirmBtn} onPress={confirm}>
                <Text style={ms.confirmBtnTxt}>Apply Range</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Reports Screen
// ─────────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const { profile, limits, tenantPlan } = useAuth();

  const today = toISO(new Date());
  const [preset,      setPreset]      = useState<Preset>('MONTH');
  const [customStart, setCustomStart] = useState(today);
  const [customEnd,   setCustomEnd]   = useState(today);
  const [showPicker,  setShowPicker]  = useState(false);

  const range = useMemo(
    () => getPresetRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  const [reportData,    setReportData]    = useState<WorkerRow[]>([]);
  const [rawAttendance, setRawAttendance] = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [exporting,     setExporting]     = useState(false);
  const [genECR,        setGenECR]        = useState(false);
  const [genESIC,       setGenESIC]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [workers, allAttendance] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getAttendanceHistory(profile.tenantId),
      ]);

      const filtered = allAttendance.filter(
        (r: any) => r.date && r.date >= range.start && r.date <= range.end,
      );
      setRawAttendance(filtered);

      const aggregated: WorkerRow[] = workers.map((worker: any) => {
        const recs = filtered.filter((r: any) => r.workerId === worker.id);
        let present = 0, absent = 0, late = 0, ot = 0, geo = 0;
        recs.forEach((r: any) => {
          if (r.status === 'PRESENT' || r.status === 'HALF_DAY') present++;
          if (r.status === 'ABSENT') absent++;
          if (r.lateStatus?.isLate) late++;
          ot += r.hours?.overtime ?? 0;
          (r.timeline ?? []).forEach((p: any) => { if (p.isOutOfGeofence) geo++; });
        });
        return {
          id: worker.id, name: worker.name ?? '',
          designation: worker.designation ?? worker.department ?? 'Worker',
          present, absent, late, geofenceViolations: geo,
          otHours:   parseFloat(ot.toFixed(1)),
          dailyWage: worker.wageConfig?.type === 'DAILY'
            ? (worker.wageConfig.amount ?? 0)
            : Math.round((worker.wageConfig?.amount ?? 0) / 26),
        };
      });

      setReportData(aggregated);
    } catch (err: any) {
      setError('Failed to load report data. Tap refresh to retry.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenantId, range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── KPIs ───────────────────────────────────────────────
  const totalPresent = reportData.reduce((s, r) => s + r.present, 0);
  const totalAbsent  = reportData.reduce((s, r) => s + r.absent,  0);
  const totalLate    = reportData.reduce((s, r) => s + r.late,    0);
  const totalOT      = reportData.reduce((s, r) => s + r.otHours, 0);
  const totalGeo     = reportData.reduce((s, r) => s + r.geofenceViolations, 0);
  const avgPct       = reportData.length > 0
    ? Math.round((totalPresent / Math.max(totalPresent + totalAbsent, 1)) * 100) : 0;

  // ── Bar chart ──────────────────────────────────────────
  const accurateBarData = useMemo<DailyBarItem[]>(() => {
    const days = eachDayInRange(range.start, range.end).slice(0, 31);
    return days.map((d) => ({
      label: dayLabel(d), frontColor: '#4F46E5',
      value: rawAttendance.filter(
        (r) => r.date === d && (r.status === 'PRESENT' || r.status === 'HALF_DAY'),
      ).length,
    }));
  }, [rawAttendance, range]);

  // ── Sorted lists ───────────────────────────────────────
  const lateList   = [...reportData].sort((a, b) => b.late    - a.late).filter((r) => r.late > 0);
  const otList     = [...reportData].sort((a, b) => b.otHours - a.otHours).filter((r) => r.otHours > 0);
  const absentList = [...reportData].sort((a, b) => b.absent  - a.absent).filter((r) => r.absent > 0);
  const totalOTCost = otList.reduce((s, r) => s + r.otHours * (r.dailyWage / 8), 0);

  // ────────────────────────────────────────────────────────
  // Export CSV
  // ────────────────────────────────────────────────────────
  const exportCSV = async () => {
    if (reportData.length === 0) {
      Alert.alert('No Data', 'No report data available for this range.');
      return;
    }
    setExporting(true);
    try {
      const headers = 'Worker Name,Designation,Present,Absent,Late Arrivals,OT Hours,Geo Violations\n';
      const rows    = reportData
        .map((r) => `"${r.name}","${r.designation}",${r.present},${r.absent},${r.late},${r.otHours},${r.geofenceViolations}`)
        .join('\n');
      const content  = headers + rows;
      const fileName = `WorkforceReport_${range.start}_to_${range.end}.csv`;

      if (Platform.OS === 'web') {
        downloadOnWeb(content, fileName, 'text/csv');
      } else {
        const fileUri  = await writeFileNative(fileName, content);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Share Report CSV' });
        } else {
          Alert.alert('Saved', `CSV saved to:\n${fileUri}`);
        }
      }
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message ?? 'Unknown error');
    } finally {
      setExporting(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // Generate EPFO ECR
  // ────────────────────────────────────────────────────────
  const handleGenerateECR = async () => {
    if (!profile?.tenantId) return;
    setGenECR(true);
    try {
      const [workers, allAtt, orgSettings] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getAttendanceHistory(profile.tenantId),
        dbService.getOrgSettings(profile.tenantId),
      ]);

      const pf = orgSettings?.compliance ?? {
        capPfDeduction: true, dailyWagePfPercentage: 100,
        pfContributionRate: 12, epsContributionRate: 8.33, epfWageCeiling: 15000,
      };

      const now         = new Date();
      const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthAtt    = allAtt.filter((r: any) => r.date?.startsWith(monthPrefix));

      const lines: string[] = [];
      let skipped = 0;

      workers.forEach((w: any) => {
        if (!w.uan) { skipped++; return; }
        const recs    = monthAtt.filter((r: any) => r.workerId === w.id);
        const present = recs.filter((r: any) =>
          r.status === 'PRESENT' || r.status === 'HALF_DAY').length;
        const workDays = w.wageConfig?.workingDaysPerMonth ?? daysInMonth;
        const ncp      = Math.max(0, workDays - present);
        const wageCeil = pf.epfWageCeiling ?? 15000;

        let gross = 0, epfWage = 0;
        if (w.wageConfig?.type === 'MONTHLY') {
          gross   = Math.round((w.wageConfig.amount / workDays) * present);
          epfWage = Math.round(
            ((w.wageConfig.monthlyBreakdown?.basic ?? w.wageConfig.amount) / workDays) * present,
          );
        } else {
          gross   = Math.round((w.wageConfig?.amount ?? 0) * present);
          epfWage = Math.round(gross * ((pf.dailyWagePfPercentage ?? 100) / 100));
        }
        if (pf.capPfDeduction && epfWage > wageCeil) epfWage = wageCeil;

        const epsWage = Math.min(epfWage, wageCeil);
        const pfRate  = (pf.pfContributionRate  ?? 12)   / 100;
        const epsRate = (pf.epsContributionRate ?? 8.33) / 100;
        const eeEPF   = Math.round(epfWage * pfRate);
        const erEPS   = Math.round(epsWage * epsRate);
        const erEPF   = eeEPF - erEPS;

        lines.push([
          w.uan, w.name, gross, epfWage, epsWage, epfWage,
          eeEPF, eeEPF, erEPS, erEPS, erEPF, erEPF, ncp,
          0, 0, 0, 0, 0,
          w.fatherName ?? w.name,
          (w.gender === 'FEMALE' || w.gender === 'Female') ? 'F' : 'M',
          w.dateOfBirth   ?? '',
          (w.gender === 'FEMALE' || w.gender === 'Female') ? 'F' : 'M',
          w.dateOfJoining ?? '', w.dateOfExit ?? '', '',
        ].join('#~#'));
      });

      if (lines.length === 0) {
        Alert.alert('No Data', `No eligible workers.\n${skipped} skipped (missing UAN).`);
        return;
      }

      const content  = lines.join('\n');
      const fileName = `EPFO_ECR_${monthPrefix.replace('-', '')}.txt`;

      if (Platform.OS === 'web') {
        downloadOnWeb(content, fileName, 'text/plain');
      } else {
        const fileUri  = await writeFileNative(fileName, content);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Share EPFO ECR' });
        }
      }

      Alert.alert(
        '✅ ECR Generated',
        `Processed: ${lines.length} workers\nSkipped: ${skipped} (no UAN)\n\nUpload at:\nunifiedportal-mem.epfindia.gov.in`,
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to generate ECR.');
    } finally {
      setGenECR(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // Generate ESIC Return
  // ────────────────────────────────────────────────────────
  const handleGenerateESIC = async () => {
    if (!profile?.tenantId) return;
    setGenESIC(true);
    try {
      const [workers, allAtt] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getAttendanceHistory(profile.tenantId),
      ]);

      const now         = new Date();
      const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthAtt    = allAtt.filter((r: any) => r.date?.startsWith(monthPrefix));

      const csvRows: string[] = [
        '"IP Number","IP Name","Days Worked","Total Monthly Wages","Reason Code","Last Working Day"',
      ];
      let skipped = 0, ineligible = 0;

      workers.forEach((w: any) => {
        if (!w.esicIp) { skipped++; return; }
        const baseGross = w.wageConfig?.type === 'MONTHLY'
          ? w.wageConfig.amount
          : (w.wageConfig?.amount ?? 0) * (w.wageConfig?.workingDaysPerMonth ?? 26);
        if (baseGross > 21000) { ineligible++; return; }

        const recs    = monthAtt.filter((r: any) => r.workerId === w.id);
        const present = recs.filter((r: any) =>
          r.status === 'PRESENT' || r.status === 'HALF_DAY').length;
        const workDays = w.wageConfig?.workingDaysPerMonth ?? daysInMonth;
        const earned   = w.wageConfig?.type === 'MONTHLY'
          ? Math.round((w.wageConfig.amount / workDays) * present)
          : Math.round((w.wageConfig?.amount ?? 0) * present);
        const reason  = present === 0 ? '2' : '';
        const lastDay = w.status === 'INACTIVE' && w.dateOfExit ? w.dateOfExit : '';
        csvRows.push(`"${w.esicIp}","${w.name}",${present},${earned},"${reason}","${lastDay}"`);
      });

      if (csvRows.length <= 1) {
        Alert.alert('No Data', `No eligible workers.\nMissing IP: ${skipped}\nSalary >₹21k: ${ineligible}`);
        return;
      }

      const content  = csvRows.join('\n');
      const fileName = `ESIC_Return_${monthPrefix.replace('-', '')}.csv`;

      if (Platform.OS === 'web') {
        downloadOnWeb(content, fileName, 'text/csv');
      } else {
        const fileUri  = await writeFileNative(fileName, content);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Share ESIC Return' });
        }
      }

      Alert.alert(
        '✅ ESIC Return Generated',
        `Processed: ${csvRows.length - 1} workers\nSkipped (no IP): ${skipped}\nIneligible (>₹21k): ${ineligible}\n\nUpload at: www.esic.in`,
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to generate ESIC file.');
    } finally {
      setGenESIC(false);
    }
  };

  // ────────────────────────────────────────────────────────
  // SectionList data
  // ────────────────────────────────────────────────────────
  const PRESETS: { id: Preset; label: string }[] = [
    { id: 'TODAY', label: 'Today'      },
    { id: 'WEEK',  label: 'This Week'  },
    { id: 'MONTH', label: 'This Month' },
    { id: 'CUSTOM',label: 'Custom'     },
  ];

  const sections = useMemo(() => [
    { key: 'KPI',    data: ['kpi']    },
    { key: 'CHART',  data: ['chart']  },
    { key: 'LATE',   data: lateList.length   > 0 ? lateList   : ['empty_late']   },
    { key: 'OT',     data: otList.length     > 0 ? otList     : ['empty_ot']     },
    { key: 'ABSENT', data: absentList.length > 0 ? absentList : ['empty_absent'] },
    { key: 'EXPORT', data: ['export'] },
  ], [lateList, otList, absentList]);

  // ────────────────────────────────────────────────────────
  // Render item
  // ────────────────────────────────────────────────────────
  const renderItem = ({ item, section }: { item: any; section: any }) => {

    if (section.key === 'KPI') {
      return (
        <View style={s.kpiGrid}>
          <KpiCard icon="checkmark-circle-outline" iconBg="#DCFCE7" iconColor="#16A34A" label="Present"      value={totalPresent} />
          <KpiCard icon="close-circle-outline"     iconBg="#FEE2E2" iconColor="#DC2626" label="Absent"       value={totalAbsent}  />
          <KpiCard icon="time-outline"             iconBg="#FEF3C7" iconColor="#D97706" label="Late"         value={totalLate}    />
          <KpiCard icon="flash-outline"            iconBg="#EDE9FE" iconColor="#7C3AED" label="OT Hours"     value={`${totalOT.toFixed(1)}h`} />
          <KpiCard icon="trending-up-outline"      iconBg="#EFF6FF" iconColor="#2563EB" label="Attendance %"  value={`${avgPct}%`} />
          <KpiCard icon="warning-outline"          iconBg="#FFF7ED" iconColor="#EA580C" label="Geo Alerts"   value={totalGeo}     />
        </View>
      );
    }

    if (section.key === 'CHART') {
      const maxVal = Math.max(...accurateBarData.map((d) => d.value), 1);
      return (
        <View style={s.chartCard}>
          <Text style={s.chartTitle}>Daily Attendance</Text>
          <Text style={s.chartSub}>{range.start}  →  {range.end}</Text>
          {loading ? (
            <View style={s.chartLoader}><ActivityIndicator color="#4F46E5" /></View>
          ) : accurateBarData.length === 0 ? (
            <EmptySection label="No attendance data in this range." />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <BarChart
                data={accurateBarData}
                width={Math.max(accurateBarData.length * 36, 280)}
                height={160}
                barWidth={22}
                spacing={14}
                barBorderRadius={6}
                maxValue={maxVal}
                noOfSections={Math.min(maxVal, 5)}
                yAxisThickness={0}
                xAxisThickness={1}
                xAxisColor="#E5E7EB"
                yAxisTextStyle={{ fontSize: 10, color: '#9CA3AF' }}
                xAxisLabelTextStyle={{ fontSize: 9, color: '#9CA3AF' }}
                rulesColor="#F3F4F6"
                rulesType="solid"
                isAnimated
              />
            </ScrollView>
          )}
        </View>
      );
    }

    if (typeof item === 'string' && item.startsWith('empty_')) {
      return (
        <EmptySection label={
          item === 'empty_late'   ? 'No late arrivals in this period.' :
          item === 'empty_ot'     ? 'No overtime recorded.'            :
                                    'No absences recorded.'
        } />
      );
    }

    if (section.key === 'LATE') {
      const deduction = Math.round(item.late * (item.dailyWage / 26));
      return (
        <View style={s.listRow}>
          <View style={[s.listAvatar, { backgroundColor: '#FEF3C7' }]}>
            <Text style={[s.listAvatarTxt, { color: '#D97706' }]}>{item.name?.[0] ?? '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.listRowName}>{item.name}</Text>
            <Text style={s.listRowSub}>{item.designation}</Text>
          </View>
          <View style={s.listRowRight}>
            <View style={s.lateBadge}>
              <Ionicons name="time-outline" size={11} color="#D97706" />
              <Text style={s.lateBadgeTxt}>{item.late}×</Text>
            </View>
            <Text style={[s.listRowAmt, { color: '#D97706' }]}>−₹{deduction}</Text>
          </View>
        </View>
      );
    }

    if (section.key === 'OT') {
      const otCost = Math.round(item.otHours * (item.dailyWage / 8));
      return (
        <View style={s.listRow}>
          <View style={[s.listAvatar, { backgroundColor: '#EDE9FE' }]}>
            <Text style={[s.listAvatarTxt, { color: '#7C3AED' }]}>{item.name?.[0] ?? '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.listRowName}>{item.name}</Text>
            <Text style={s.listRowSub}>{item.designation}</Text>
          </View>
          <View style={s.listRowRight}>
            <View style={s.otBadge}>
              <Ionicons name="flash-outline" size={11} color="#7C3AED" />
              <Text style={s.otBadgeTxt}>{item.otHours}h</Text>
            </View>
            <Text style={[s.listRowAmt, { color: '#7C3AED' }]}>+₹{otCost}</Text>
          </View>
        </View>
      );
    }

    if (section.key === 'ABSENT') {
      return (
        <View style={s.listRow}>
          <View style={[s.listAvatar, { backgroundColor: '#FEE2E2' }]}>
            <Text style={[s.listAvatarTxt, { color: '#DC2626' }]}>{item.name?.[0] ?? '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.listRowName}>{item.name}</Text>
            <Text style={s.listRowSub}>{item.designation}</Text>
          </View>
          <View style={s.listRowRight}>
            <View style={s.absentBadge}>
              <Text style={s.absentBadgeTxt}>{item.absent} days</Text>
            </View>
            <Text style={[s.listRowAmt, { color: '#DC2626' }]}>
              −₹{Math.round(item.absent * item.dailyWage)}
            </Text>
          </View>
        </View>
      );
    }

    if (section.key === 'EXPORT') {
      return (
        <View style={s.exportSection}>
          {/* CSV Export */}
          <View style={s.exportCard}>
            <View style={s.exportCardHeader}>
              <View style={[s.exportCardIcon, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="document-text-outline" size={18} color="#16A34A" />
              </View>
              <View>
                <Text style={s.exportCardTitle}>Monthly Muster CSV</Text>
                <Text style={s.exportCardSub}>All workers · Full attendance summary</Text>
              </View>
            </View>
            {tenantPlan !== 'FREE' ? (
              <Pressable
                style={[s.exportBtn, { backgroundColor: '#16A34A' }, (exporting || loading) && { opacity: 0.5 }]}
                onPress={exportCSV} disabled={exporting || loading}>
                {exporting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="download-outline" size={16} color="#fff" />}
                <Text style={s.exportBtnTxt}>{exporting ? 'Exporting…' : 'Export CSV'}</Text>
              </Pressable>
            ) : (
              <View style={s.lockedExportBtn}>
                <Ionicons name="lock-closed" size={12} color="#9CA3AF" />
                <Text style={s.lockedExportTxt}>Starter Plan required</Text>
              </View>
            )}
          </View>

          {limits?.statutoryComplianceEnabled ? (
            <>
              {/* EPFO ECR */}
              <View style={s.exportCard}>
                <View style={s.exportCardHeader}>
                  <View style={[s.exportCardIcon, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#4F46E5" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.exportCardTitle}>EPFO ECR (Monthly)</Text>
                    <Text style={s.exportCardSub}>Plain .txt · 25 fields · #~# delimited</Text>
                  </View>
                </View>
                <View style={s.bulletList}>
                  {['UAN-based filing', 'EE 12% + ER split (8.33% EPS + 3.67% EPF)', 'NCP days auto-calculated'].map((l) => (
                    <View key={l} style={s.bulletRow}>
                      <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                      <Text style={s.bulletTxt}>{l}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  style={[s.exportBtn, { backgroundColor: '#4F46E5' }, genECR && { opacity: 0.5 }]}
                  onPress={handleGenerateECR} disabled={genECR}>
                  {genECR
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="download-outline" size={16} color="#fff" />}
                  <Text style={s.exportBtnTxt}>{genECR ? 'Generating…' : 'Generate EPFO ECR'}</Text>
                </Pressable>
              </View>

              {/* ESIC */}
              <View style={s.exportCard}>
                <View style={s.exportCardHeader}>
                  <View style={[s.exportCardIcon, { backgroundColor: '#F0FDF4' }]}>
                    <Ionicons name="medkit-outline" size={18} color="#0D9488" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.exportCardTitle}>ESIC Return (Monthly)</Text>
                    <Text style={s.exportCardSub}>CSV format · Salary ≤ ₹21,000 eligible</Text>
                  </View>
                </View>
                <View style={s.bulletList}>
                  {['IP Number validation', 'Earned gross wages auto-calculated', 'Reason codes for 0-day workers'].map((l) => (
                    <View key={l} style={s.bulletRow}>
                      <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                      <Text style={s.bulletTxt}>{l}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  style={[s.exportBtn, { backgroundColor: '#0D9488' }, genESIC && { opacity: 0.5 }]}
                  onPress={handleGenerateESIC} disabled={genESIC}>
                  {genESIC
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="download-outline" size={16} color="#fff" />}
                  <Text style={s.exportBtnTxt}>{genESIC ? 'Generating…' : 'Generate ESIC Return'}</Text>
                </Pressable>
              </View>

              <View style={s.infoBox}>
                <Ionicons name="calendar-outline" size={13} color="#4F46E5" style={{ marginTop: 1 }} />
                <Text style={s.infoTxt}>
                  <Text style={{ fontWeight: '800', color: '#4F46E5' }}>Due: 15th</Text> of following month.{' '}
                  Workers need <Text style={{ fontWeight: '700' }}>UAN</Text> (EPFO) and{' '}
                  <Text style={{ fontWeight: '700' }}>IP Number</Text> (ESIC) in Worker Settings.
                </Text>
              </View>
            </>
          ) : (
            <View style={s.lockedComplianceCard}>
              <Ionicons name="lock-closed" size={22} color="#9CA3AF" />
              <Text style={s.lockedComplianceTitle}>Statutory Returns Locked</Text>
              <Text style={s.lockedComplianceSub}>
                EPFO ECR and ESIC Return generators require the Enterprise plan.
              </Text>
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  const renderSectionHeader = ({ section }: { section: any }) => {
    if (section.key === 'KPI'   ) return null;
    if (section.key === 'CHART' ) return null;
    if (section.key === 'EXPORT') return <SectionHeader title="Export & Compliance"                                                  icon="download-outline"      color="#16A34A" />;
    if (section.key === 'LATE'  ) return <SectionHeader title={`Late Arrivals (${lateList.length})`}                                 icon="time-outline"          color="#D97706" />;
    if (section.key === 'OT'    ) return <SectionHeader title={`Overtime — Est. Cost ₹${Math.round(totalOTCost).toLocaleString('en-IN')}`} icon="flash-outline"   color="#7C3AED" />;
    if (section.key === 'ABSENT') return <SectionHeader title={`Absences (${absentList.length})`}                                   icon="person-remove-outline"  color="#DC2626" />;
    return null;
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Factory Reports</Text>
          <Text style={s.headerSub}>
            {range.start === range.end ? range.start : `${range.start} → ${range.end}`}
          </Text>
        </View>
        <Pressable style={s.refreshBtn} onPress={fetchData} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#4F46E5" />
            : <Ionicons name="refresh-outline" size={20} color="#4F46E5" />
          }
        </Pressable>
      </View>

      {/* Preset bar */}
      <View style={s.presetBar}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.id}
            style={[s.presetPill, preset === p.id && s.presetPillActive]}
            onPress={() => { if (p.id === 'CUSTOM') setShowPicker(true); else setPreset(p.id); }}
          >
            <Text style={[s.presetTxt, preset === p.id && s.presetTxtActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={s.errorBar}>
          <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
          <Text style={s.errorTxt}>{error}</Text>
          <Pressable onPress={fetchData}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      )}

      {loading && reportData.length === 0 ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={s.loadingTxt}>Loading report data…</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) =>
            typeof item === 'string' ? item + index : (item as WorkerRow).id + index}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={s.rowSep} />}
          SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      <DateRangeModal
        visible={showPicker}
        start={customStart}
        end={customEnd}
        onConfirm={(newStart, newEnd) => {
          setCustomStart(newStart); setCustomEnd(newEnd);
          setPreset('CUSTOM'); setShowPicker(false);
        }}
        onClose={() => setShowPicker(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#F9FAFB' },
  header:      { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#111827' },
  headerSub:   { fontSize: 11, color: '#6B7280', marginTop: 2, fontFamily: MONO },
  refreshBtn:  { width: 38, height: 38, borderRadius: 10, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  presetBar:        { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  presetPill:       { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 12, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  presetPillActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  presetTxt:        { fontSize: 11, fontWeight: '800', color: '#6B7280' },
  presetTxtActive:  { color: '#fff' },
  errorBar:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 12, marginHorizontal: 14, marginTop: 10, padding: 10 },
  errorTxt:    { flex: 1, fontSize: 12, color: '#DC2626' },
  retryTxt:    { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt:  { fontSize: 13, color: '#9CA3AF' },
  listContent: { padding: 14, paddingBottom: 60 },
  kpiGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  kpiCard:     { width: '30%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  kpiIcon:     { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  kpiLabel:    { fontSize: 9, fontWeight: '900', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue:    { fontSize: 22, fontWeight: '900', color: '#111827', marginTop: 2 },
  chartCard:   { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 6, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  chartTitle:  { fontSize: 13, fontWeight: '900', color: '#111827' },
  chartSub:    { fontSize: 10, color: '#9CA3AF', fontFamily: MONO, marginBottom: 12 },
  chartLoader: { height: 160, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4, backgroundColor: '#F9FAFB' },
  sectionHeaderIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderTxt:  { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  listRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 12 },
  listAvatar:    { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  listAvatarTxt: { fontSize: 16, fontWeight: '900' },
  listRowName:   { fontSize: 13, fontWeight: '800', color: '#111827' },
  listRowSub:    { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  listRowRight:  { alignItems: 'flex-end', gap: 4 },
  listRowAmt:    { fontSize: 12, fontWeight: '700', fontFamily: MONO },
  rowSep:        { height: 1, backgroundColor: '#F9FAFB', marginLeft: 64 },
  lateBadge:     { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  lateBadgeTxt:  { fontSize: 11, fontWeight: '800', color: '#D97706' },
  otBadge:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F5F3FF', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  otBadgeTxt:    { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  absentBadge:   { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  absentBadgeTxt:{ fontSize: 11, fontWeight: '800', color: '#DC2626' },
  emptySection:    { alignItems: 'center', paddingVertical: 20, gap: 6, backgroundColor: '#fff' },
  emptySectionTxt: { fontSize: 12, color: '#9CA3AF' },
  exportSection:         { gap: 14 },
  exportCard:            { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  exportCardHeader:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exportCardIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  exportCardTitle:       { fontSize: 14, fontWeight: '900', color: '#111827' },
  exportCardSub:         { fontSize: 11, color: '#6B7280', marginTop: 1 },
  exportBtn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 11 },
  exportBtnTxt:          { color: '#fff', fontSize: 14, fontWeight: '700' },
  lockedExportBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 11 },
  lockedExportTxt:       { fontSize: 13, fontWeight: '700', color: '#9CA3AF' },
  bulletList:            { gap: 4 },
  bulletRow:             { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bulletTxt:             { fontSize: 12, color: '#6B7280' },
  infoBox:               { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#C7D2FE' },
  infoTxt:               { flex: 1, fontSize: 12, color: '#4338CA', lineHeight: 18 },
  lockedComplianceCard:  { alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 16, padding: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: '#E5E7EB', gap: 8 },
  lockedComplianceTitle: { fontSize: 14, fontWeight: '800', color: '#374151' },
  lockedComplianceSub:   { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 18 },
});

const ms = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modal:         { backgroundColor: '#fff', borderRadius: 20, padding: 22, width: '100%', maxWidth: 380 },
  modalTitle:    { fontSize: 16, fontWeight: '900', color: '#111827', marginBottom: 16, textAlign: 'center' },
  dateLabel:     { fontSize: 10, fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  dateInput:     { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111827', backgroundColor: '#F9FAFB', marginBottom: 14 },
  modalBtns:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:     { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#F3F4F6' },
  cancelBtnTxt:  { fontSize: 14, fontWeight: '700', color: '#6B7280' },
  confirmBtn:    { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#4F46E5' },
  confirmBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
