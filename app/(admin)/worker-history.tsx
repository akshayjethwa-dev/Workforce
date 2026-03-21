// app/(admin)/worker-history.tsx
// Task 18: Worker History Screen (Expo React Native)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  SectionList, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Print   from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth }   from './../../src/contexts/AuthContext';
import { dbService } from './../../src/services/db';
import { Worker, AttendanceRecord } from './../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Status maps — aligned to your actual AttendanceRecord union:
// "PRESENT" | "HALF_DAY" | "ABSENT" | "WEEKLY_OFF"
// | "ON_LEAVE" | "PUBLIC_HOLIDAY" | "HOLIDAY_WORKED" | "UNPAID_HOLIDAY"
// ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  PRESENT:         '#16A34A',
  HALF_DAY:        '#2563EB',
  LATE:            '#D97706',   // virtual — derived, not in union
  ABSENT:          '#DC2626',
  ON_LEAVE:        '#7C3AED',
  WEEKLY_OFF:      '#9CA3AF',
  PUBLIC_HOLIDAY:  '#6B7280',
  HOLIDAY_WORKED:  '#0D9488',
  UNPAID_HOLIDAY:  '#F59E0B',
};

const STATUS_BG: Record<string, string> = {
  PRESENT:         '#DCFCE7',
  HALF_DAY:        '#DBEAFE',
  LATE:            '#FEF3C7',
  ABSENT:          '#FEE2E2',
  ON_LEAVE:        '#EDE9FE',
  WEEKLY_OFF:      '#F3F4F6',
  PUBLIC_HOLIDAY:  '#F3F4F6',
  HOLIDAY_WORKED:  '#CCFBF1',
  UNPAID_HOLIDAY:  '#FEF3C7',
};

// Human-readable labels
const STATUS_LABEL: Record<string, string> = {
  PRESENT:         'PRESENT',
  HALF_DAY:        'HALF DAY',
  LATE:            'LATE',
  ABSENT:          'ABSENT',
  ON_LEAVE:        'LEAVE',
  WEEKLY_OFF:      'OFF',
  PUBLIC_HOLIDAY:  'HOLIDAY',
  HOLIDAY_WORKED:  'HOL.WORK',
  UNPAID_HOLIDAY:  'UNPAID',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const pad   = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date)   => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fmtTime = (t?: any): string => {
  if (!t) return '—';
  if (typeof t === 'string') return t.slice(0, 5);
  const val = t.time ?? t.displayTime ?? t.timestamp ?? t.hhmm ?? '';
  return val ? String(val).slice(0, 5) : '—';
};

const fmtHours = (h?: number) => h != null ? `${h.toFixed(1)}h` : '—';

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
}

// Returns a display-status string (may return virtual 'LATE')
function resolvedDisplayStatus(
  iso: string,
  attMap: Map<string, AttendanceRecord>,
): { status: string; isLate: boolean } {
  const rec = attMap.get(iso);
  if (!rec) return { status: 'ABSENT', isLate: false };
  const isLate = !!rec.lateStatus?.isLate;
  if (isLate && rec.status === 'PRESENT') return { status: 'LATE', isLate: true };
  return { status: rec.status, isLate };
}

// Is the record a "leave" type?
function isLeaveStatus(status: AttendanceRecord['status']) {
  return status === 'ON_LEAVE' || status === 'UNPAID_HOLIDAY';
}

// Is the record an "off/holiday" type?
function isOffStatus(status: AttendanceRecord['status']) {
  return (
    status === 'WEEKLY_OFF' ||
    status === 'PUBLIC_HOLIDAY' ||
    status === 'HOLIDAY_WORKED'
  );
}

// ─────────────────────────────────────────────────────────────
// Payslip HTML
// ─────────────────────────────────────────────────────────────
function buildPayslipHTML(params: {
  worker:      Worker;
  month:       number;
  year:        number;
  records:     AttendanceRecord[];
  orgName:     string;
  orgSettings: any;
}): string {
  const { worker, month, year, records, orgName, orgSettings } = params;
  const pf = orgSettings?.compliance ?? {};

  const workDays  = (worker as any).wageConfig?.workingDaysPerMonth ?? 26;
  const present   = records.filter(
    (r) => r.status === 'PRESENT' || r.status === 'HALF_DAY'
  ).length;
  const halfDays  = records.filter((r) => r.status === 'HALF_DAY').length;
  const absent    = Math.max(0, workDays - present);
  const late      = records.filter((r) => r.lateStatus?.isLate).length;
  const otHours   = records.reduce((s, r) => s + ((r as any).hours?.overtime ?? 0), 0);
  // ✅ ON_LEAVE instead of LEAVE
  const leaveDays = records.filter((r) => r.status === 'ON_LEAVE').length;

  const wageType   = (worker as any).wageConfig?.type   ?? 'DAILY';
  const wageAmount = (worker as any).wageConfig?.amount ?? 0;
  const dailyRate  = wageType === 'MONTHLY' ? wageAmount / workDays : wageAmount;

  let grossEarned = 0, basicSalary = 0, otPay = 0;
  if (wageType === 'MONTHLY') {
    const effectiveDays = present - halfDays * 0.5;
    grossEarned = Math.round((wageAmount / workDays) * effectiveDays);
    basicSalary = Math.round(
      ((worker as any).wageConfig?.monthlyBreakdown?.basic ?? wageAmount)
      / workDays * effectiveDays
    );
    otPay = Math.round(otHours * (dailyRate / 8) * 1.5);
  } else {
    grossEarned = Math.round(dailyRate * present);
    basicSalary = grossEarned;
    otPay       = Math.round(otHours * (dailyRate / 8) * 1.5);
  }

  const totalEarnings = grossEarned + otPay;

  let pfDeduction = 0, esicDeduction = 0, lateDeduction = 0;
  if ((worker as any).pfEnabled) {
    const pfWage = Math.min(basicSalary, pf.epfWageCeiling ?? 15000);
    pfDeduction  = Math.round(pfWage * ((pf.pfContributionRate ?? 12) / 100));
  }
  if ((worker as any).esicEnabled && grossEarned <= 21000) {
    esicDeduction = Math.round(totalEarnings * 0.0075);
  }
  lateDeduction = Math.round(late * (dailyRate / 26));

  const totalDeductions = pfDeduction + esicDeduction + lateDeduction;
  const netPay          = Math.max(0, totalEarnings - totalDeductions);
  const monthLabel      = `${MONTH_NAMES[month]} ${year}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;padding:32px;color:#111827;font-size:13px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #4F46E5;padding-bottom:16px;margin-bottom:20px}
  .company{font-size:20px;font-weight:900;color:#4F46E5}
  .payslip-label{font-size:11px;color:#6B7280;margin-top:4px}
  .month-label{font-size:14px;font-weight:700;color:#111827;text-align:right}
  .worker-section{background:#F9FAFB;border-radius:8px;padding:14px;margin-bottom:20px;display:flex;gap:40px;flex-wrap:wrap}
  .field label{font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.5px}
  .field p{font-size:13px;font-weight:600;color:#111827;margin-top:2px}
  .section-title{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#6B7280;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#4F46E5;color:#fff;font-size:11px;font-weight:700;padding:8px 10px;text-align:left}
  td{padding:8px 10px;border-bottom:1px solid #F3F4F6;font-size:12px}
  tr:nth-child(even) td{background:#F9FAFB}
  .amount{text-align:right}
  .total-row td{font-weight:900;background:#EEF2FF!important;color:#4F46E5}
  .deduction{color:#DC2626}
  .net-pay{background:#4F46E5;color:#fff;border-radius:8px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:8px}
  .net-label{font-size:12px;opacity:0.8}
  .net-amount{font-size:24px;font-weight:900}
  .attendance-summary{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
  .att-chip{background:#F3F4F6;border-radius:8px;padding:8px 14px;text-align:center}
  .att-chip .val{font-size:18px;font-weight:900;color:#111827}
  .att-chip .lbl{font-size:10px;color:#6B7280;margin-top:2px}
  .footer{border-top:1px solid #E5E7EB;padding-top:14px;margin-top:20px;display:flex;justify-content:space-between;color:#9CA3AF;font-size:10px}
  .generated{color:#9CA3AF;font-size:10px;margin-top:4px}
</style></head>
<body>
<div class="header">
  <div>
    <div class="company">${orgName}</div>
    <div class="payslip-label">SALARY SLIP / PAYSLIP</div>
    <div class="generated">Generated: ${new Date().toLocaleDateString('en-IN')}</div>
  </div>
  <div class="month-label">${monthLabel}</div>
</div>
<div class="worker-section">
  <div class="field"><label>Employee Name</label><p>${worker.name}</p></div>
  <div class="field"><label>Department</label><p>${(worker as any).department ?? (worker as any).designation ?? '—'}</p></div>
  <div class="field"><label>Salary Type</label><p>${wageType === 'MONTHLY' ? 'Monthly ₹' + wageAmount.toLocaleString('en-IN') : 'Daily ₹' + wageAmount + '/day'}</p></div>
  ${(worker as any).uan    ? `<div class="field"><label>UAN</label><p>${(worker as any).uan}</p></div>` : ''}
  ${(worker as any).esicIp ? `<div class="field"><label>ESIC IP</label><p>${(worker as any).esicIp}</p></div>` : ''}
</div>
<p class="section-title">Attendance Summary</p>
<div class="attendance-summary">
  <div class="att-chip"><div class="val" style="color:#16A34A">${present}</div><div class="lbl">Present</div></div>
  <div class="att-chip"><div class="val" style="color:#DC2626">${absent}</div><div class="lbl">Absent</div></div>
  <div class="att-chip"><div class="val" style="color:#D97706">${late}</div><div class="lbl">Late</div></div>
  <div class="att-chip"><div class="val" style="color:#2563EB">${halfDays}</div><div class="lbl">Half Day</div></div>
  <div class="att-chip"><div class="val" style="color:#7C3AED">${leaveDays}</div><div class="lbl">Leave</div></div>
  <div class="att-chip"><div class="val" style="color:#0D9488">${otHours.toFixed(1)}h</div><div class="lbl">OT Hours</div></div>
</div>
<p class="section-title">Earnings</p>
<table>
  <tr><th>Component</th><th class="amount">Amount (₹)</th></tr>
  <tr><td>Basic / Gross Wages</td><td class="amount">${grossEarned.toLocaleString('en-IN')}</td></tr>
  ${otPay > 0 ? `<tr><td>Overtime Pay (${otHours.toFixed(1)}h × 1.5×)</td><td class="amount">${otPay.toLocaleString('en-IN')}</td></tr>` : ''}
  <tr class="total-row"><td>Total Earnings</td><td class="amount">${totalEarnings.toLocaleString('en-IN')}</td></tr>
</table>
<p class="section-title">Deductions</p>
<table>
  <tr><th>Component</th><th class="amount">Amount (₹)</th></tr>
  ${pfDeduction   > 0 ? `<tr><td>PF (Employee 12%)</td><td class="amount deduction">− ${pfDeduction.toLocaleString('en-IN')}</td></tr>` : ''}
  ${esicDeduction > 0 ? `<tr><td>ESIC (Employee 0.75%)</td><td class="amount deduction">− ${esicDeduction.toLocaleString('en-IN')}</td></tr>` : ''}
  ${lateDeduction > 0 ? `<tr><td>Late Deduction (${late} × ₹${Math.round(dailyRate / 26)})</td><td class="amount deduction">− ${lateDeduction.toLocaleString('en-IN')}</td></tr>` : ''}
  ${totalDeductions === 0 ? '<tr><td colspan="2" style="color:#9CA3AF;text-align:center">No deductions</td></tr>' : ''}
  <tr class="total-row"><td>Total Deductions</td><td class="amount deduction">− ${totalDeductions.toLocaleString('en-IN')}</td></tr>
</table>
<div class="net-pay">
  <div>
    <div class="net-label">Net Pay (Take Home)</div>
    <div style="font-size:10px;opacity:0.7;margin-top:2px">${monthLabel}</div>
  </div>
  <div class="net-amount">₹ ${netPay.toLocaleString('en-IN')}</div>
</div>
<div class="footer">
  <div>This is a computer-generated payslip.</div>
  <div>${orgName}</div>
</div>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────
const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function MonthCalendar({
  year, month, attMap, joiningDate,
}: {
  year: number; month: number;
  attMap: Map<string, AttendanceRecord>;
  joiningDate: string;
}) {
  const days        = getDaysInMonth(year, month);
  const firstDay    = getFirstDayOfWeek(year, month);
  const today       = toISO(new Date());
  const monthPrefix = `${year}-${pad(month + 1)}`;

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  return (
    <View style={cal.container}>
      <View style={cal.headerRow}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={cal.headerCell}>
            <Text style={cal.headerTxt}>{d}</Text>
          </View>
        ))}
      </View>

      <View style={cal.grid}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={`b-${idx}`} style={cal.cell} />;

          const iso      = `${monthPrefix}-${pad(day)}`;
          const isFuture = iso > today;
          const isJoined = iso >= joiningDate;

          if (isFuture || !isJoined) {
            return (
              <View key={iso} style={[cal.cell, { opacity: 0.3 }]}>
                <Text style={cal.dayNum}>{day}</Text>
              </View>
            );
          }

          const { status, isLate } = resolvedDisplayStatus(iso, attMap);
          const bgColor   = STATUS_BG[status]     ?? '#F3F4F6';
          const textColor = STATUS_COLORS[status] ?? '#6B7280';

          return (
            <View key={iso} style={[cal.cell, cal.filledCell, { backgroundColor: bgColor }]}>
              <Text style={[cal.dayNum, { color: textColor }]}>{day}</Text>
              {status === 'PRESENT' && !isLate && (
                <Ionicons name="checkmark" size={8} color={textColor} />
              )}
              {isLate && (
                <Ionicons name="time-outline" size={8} color={STATUS_COLORS.LATE} />
              )}
              {status === 'ABSENT' && (
                <Ionicons name="close" size={8} color={textColor} />
              )}
              {status === 'HALF_DAY' && (
                <Text style={[cal.statusDot, { color: textColor }]}>½</Text>
              )}
              {/* ✅ ON_LEAVE instead of LEAVE */}
              {status === 'ON_LEAVE' && (
                <Text style={[cal.statusDot, { color: textColor }]}>L</Text>
              )}
              {status === 'UNPAID_HOLIDAY' && (
                <Text style={[cal.statusDot, { color: textColor }]}>U</Text>
              )}
              {(status === 'WEEKLY_OFF' || status === 'PUBLIC_HOLIDAY') && (
                <Text style={[cal.statusDot, { color: textColor }]}>—</Text>
              )}
              {status === 'HOLIDAY_WORKED' && (
                <Text style={[cal.statusDot, { color: textColor }]}>H</Text>
              )}
            </View>
          );
        })}
      </View>

      <View style={cal.legend}>
        {[
          { label: 'Present',  color: STATUS_COLORS.PRESENT        },
          { label: 'Absent',   color: STATUS_COLORS.ABSENT         },
          { label: 'Late',     color: STATUS_COLORS.LATE           },
          { label: 'Half Day', color: STATUS_COLORS.HALF_DAY       },
          { label: 'Leave',    color: STATUS_COLORS.ON_LEAVE       },
          { label: 'Off',      color: STATUS_COLORS.WEEKLY_OFF     },
          { label: 'Holiday',  color: STATUS_COLORS.PUBLIC_HOLIDAY },
        ].map((item) => (
          <View key={item.label} style={cal.legendItem}>
            <View style={[cal.legendDot, { backgroundColor: item.color }]} />
            <Text style={cal.legendTxt}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Attendance row
// ─────────────────────────────────────────────────────────────
function AttendanceRow({ record }: { record: AttendanceRecord }) {
  const displayStatus = record.lateStatus?.isLate && record.status === 'PRESENT'
    ? 'LATE' : record.status;
  const bgColor  = STATUS_BG[displayStatus]     ?? '#F3F4F6';
  const txtColor = STATUS_COLORS[displayStatus] ?? '#6B7280';
  const label    = STATUS_LABEL[displayStatus]  ?? displayStatus;

  const d       = new Date(record.date + 'T00:00:00');
  const dateStr = `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}, ${
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  }`;

  return (
    <View style={ar.row}>
      <View style={[ar.statusBar, { backgroundColor: txtColor }]} />
      <View style={ar.dateCol}>
        <Text style={ar.dateTxt}>{dateStr}</Text>
      </View>
      <View style={ar.timesCol}>
        <View style={ar.timeChip}>
          <Ionicons name="enter-outline" size={11} color="#16A34A" />
          <Text style={ar.timeInTxt}>{fmtTime((record as any).inTime)}</Text>
        </View>
        <View style={ar.timeChip}>
          <Ionicons name="exit-outline" size={11} color="#DC2626" />
          <Text style={ar.timeOutTxt}>{fmtTime((record as any).outTime)}</Text>
        </View>
      </View>
      <View style={ar.hoursCol}>
        <Text style={ar.hoursTxt}>{fmtHours((record as any).hours?.worked)}</Text>
        {((record as any).hours?.overtime ?? 0) > 0 && (
          <Text style={ar.otTxt}>+{fmtHours((record as any).hours?.overtime)} OT</Text>
        )}
      </View>
      <View style={[ar.badge, { backgroundColor: bgColor }]}>
        <Text style={[ar.badgeTxt, { color: txtColor }]}>{label}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function WorkerHistoryScreen() {
  const { workerId } = useLocalSearchParams<{ workerId: string }>();
  const { profile }  = useAuth();
  const router       = useRouter();

  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [worker,      setWorker]      = useState<Worker | null>(null);
  const [records,     setRecords]     = useState<AttendanceRecord[]>([]);
  const [orgSettings, setOrgSettings] = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [genPDF,      setGenPDF]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // ── Fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!profile?.tenantId || !workerId) return;
    setLoading(true);
    setError(null);
    try {
      const monthPrefix = `${year}-${pad(month + 1)}`;
      const [workerData, monthRecs, settings] = await Promise.all([
        dbService.getWorker(profile.tenantId, workerId),
        dbService.getAttendanceByWorkerAndMonth(profile.tenantId, workerId, monthPrefix),
        dbService.getOrgSettings(profile.tenantId),
      ]);
      setWorker(workerData);
      setRecords(monthRecs);
      setOrgSettings(settings);
    } catch (err: any) {
      setError('Failed to load worker data.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenantId, workerId, year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived ──────────────────────────────────────────────
  const attMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    records.forEach((r) => map.set(r.date, r));
    return map;
  }, [records]);

  const summary = useMemo(() => {
    const present  = records.filter((r) => r.status === 'PRESENT').length;
    const halfDay  = records.filter((r) => r.status === 'HALF_DAY').length;
    const late     = records.filter((r) => r.lateStatus?.isLate).length;
    // ✅ ON_LEAVE instead of LEAVE
    const leave    = records.filter((r) => r.status === 'ON_LEAVE').length;
    const otHours  = records.reduce((s, r) => s + ((r as any).hours?.overtime ?? 0), 0);
    const workDays = (worker as any)?.wageConfig?.workingDaysPerMonth ?? 26;
    const absent   = Math.max(0, workDays - present - halfDay - leave);
    return { present, halfDay, absent, late, leave, otHours };
  }, [records, worker]);

  // ── Month nav ────────────────────────────────────────────
  const goPrevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else { setMonth((m) => m - 1); }
  };
  const goNextMonth = () => {
    const n = new Date();
    if (year === n.getFullYear() && month === n.getMonth()) return;
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else { setMonth((m) => m + 1); }
  };

  const isCurrentMonth = useMemo(() => {
    const n = new Date();
    return year === n.getFullYear() && month === n.getMonth();
  }, [year, month]);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );

  // ── Payslip ──────────────────────────────────────────────
  const handleGeneratePayslip = async () => {
    if (!worker) return;
    setGenPDF(true);
    try {
      const orgName = orgSettings?.name ?? 'WorkforcePro';
      const html    = buildPayslipHTML({ worker, month, year, records, orgName, orgSettings });

      if (Platform.OS === 'web') {
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.print(); }
        return;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType:    'application/pdf',
          dialogTitle: `Payslip — ${worker.name} — ${MONTH_NAMES[month]} ${year}`,
          UTI:         'com.adobe.pdf',
        });
      } else {
        Alert.alert('PDF Generated', `Saved to:\n${uri}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to generate payslip.');
    } finally {
      setGenPDF(false);
    }
  };

  // ── Sections ─────────────────────────────────────────────
  const sections = useMemo(() => [
    { key: 'PROFILE',  data: ['profile']  },
    { key: 'SUMMARY',  data: ['summary']  },
    { key: 'CALENDAR', data: ['calendar'] },
    { key: 'RECORDS',  data: sortedRecords.length > 0 ? sortedRecords : ['empty'] },
    { key: 'PAYSLIP',  data: ['payslip']  },
  ], [sortedRecords]);

  const renderSectionHeader = ({ section }: { section: any }) => {
    if (section.key !== 'RECORDS') return null;
    return (
      <View style={s.sectionHeaderRow}>
        <Ionicons name="list-outline" size={14} color="#4F46E5" />
        <Text style={s.sectionHeaderTxt}>Daily Records</Text>
        <Text style={s.sectionHeaderCount}>{sortedRecords.length} entries</Text>
      </View>
    );
  };

  const renderItem = ({ item, section }: { item: any; section: any }) => {

    if (section.key === 'PROFILE') {
      return (
        <View style={s.profileCard}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{worker?.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.workerName}>{worker?.name ?? '—'}</Text>
            <Text style={s.workerSub}>
              {(worker as any)?.designation ?? (worker as any)?.department ?? 'Worker'}
              {(worker as any)?.branch ? ` · ${(worker as any).branch}` : ''}
            </Text>
            <View style={s.tagRow}>
              <View style={s.tag}>
                <Ionicons name="cash-outline" size={11} color="#4F46E5" />
                <Text style={s.tagTxt}>
                  {(worker as any)?.wageConfig?.type === 'MONTHLY'
                    ? `₹${((worker as any).wageConfig.amount ?? 0).toLocaleString('en-IN')}/mo`
                    : `₹${(worker as any)?.wageConfig?.amount ?? 0}/day`}
                </Text>
              </View>
              {(worker as any)?.pfEnabled && (
                <View style={[s.tag, { backgroundColor: '#DCFCE7' }]}>
                  <Text style={[s.tagTxt, { color: '#16A34A' }]}>PF</Text>
                </View>
              )}
              {(worker as any)?.esicEnabled && (
                <View style={[s.tag, { backgroundColor: '#DBEAFE' }]}>
                  <Text style={[s.tagTxt, { color: '#2563EB' }]}>ESIC</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      );
    }

    if (section.key === 'SUMMARY') {
      return (
        <View style={s.summaryCard}>
          {([
            { label: 'Present',  value: summary.present,            color: '#16A34A' },
            { label: 'Absent',   value: summary.absent,             color: '#DC2626' },
            { label: 'Late',     value: summary.late,               color: '#D97706' },
            { label: 'Half Day', value: summary.halfDay,            color: '#2563EB' },
            { label: 'Leave',    value: summary.leave,              color: '#7C3AED' },
            { label: 'OT Hrs',   value: summary.otHours.toFixed(1), color: '#0D9488' },
          ] as const).map((chip) => (
            <View key={chip.label} style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: chip.color }]}>{chip.value}</Text>
              <Text style={s.summaryLbl}>{chip.label}</Text>
            </View>
          ))}
        </View>
      );
    }

    if (section.key === 'CALENDAR') {
      return (
        <View style={s.calendarWrap}>
          {worker && (
            <MonthCalendar
              year={year} month={month} attMap={attMap}
              joiningDate={(worker as any).joiningDate ?? '2000-01-01'}
            />
          )}
        </View>
      );
    }

    if (section.key === 'RECORDS' && item === 'empty') {
      return (
        <View style={s.emptyRecords}>
          <Ionicons name="calendar-outline" size={32} color="#E5E7EB" />
          <Text style={s.emptyRecordsTxt}>No records for this month.</Text>
        </View>
      );
    }

    if (section.key === 'RECORDS') {
      return <AttendanceRow record={item as AttendanceRecord} />;
    }

    if (section.key === 'PAYSLIP') {
      return (
        <View style={s.payslipCard}>
          <View style={s.payslipInfo}>
            <View style={[s.payslipIcon, { backgroundColor: '#EEF2FF' }]}>
              <Ionicons name="document-text-outline" size={22} color="#4F46E5" />
            </View>
            <View>
              <Text style={s.payslipTitle}>Generate Payslip</Text>
              <Text style={s.payslipSub}>
                {MONTH_NAMES[month]} {year} · PDF via share sheet
              </Text>
            </View>
          </View>
          <Pressable
            style={[s.payslipBtn, genPDF && { opacity: 0.6 }]}
            onPress={handleGeneratePayslip}
            disabled={genPDF || loading}
          >
            {genPDF
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="download-outline" size={16} color="#fff" />
            }
            <Text style={s.payslipBtnTxt}>
              {genPDF ? 'Generating…' : 'Generate & Share PDF'}
            </Text>
          </Pressable>
        </View>
      );
    }

    return null;
  };

  // ── Guard ─────────────────────────────────────────────────
  if (!workerId) {
    return (
      <View style={s.centered}>
        <Text style={s.errorTxt}>No worker selected.</Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </Pressable>
        <Text style={s.topBarTitle} numberOfLines={1}>
          {worker?.name ?? 'Worker History'}
        </Text>
        <Pressable style={s.refreshBtn} onPress={fetchData} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#4F46E5" />
            : <Ionicons name="refresh-outline" size={20} color="#4F46E5" />
          }
        </Pressable>
      </View>

      <View style={s.monthNav}>
        <Pressable style={s.monthArrow} onPress={goPrevMonth}>
          <Ionicons name="chevron-back" size={20} color="#4F46E5" />
        </Pressable>
        <Text style={s.monthLabel}>{MONTH_NAMES[month]} {year}</Text>
        <Pressable
          style={[s.monthArrow, isCurrentMonth && { opacity: 0.3 }]}
          onPress={goNextMonth}
          disabled={isCurrentMonth}
        >
          <Ionicons name="chevron-forward" size={20} color="#4F46E5" />
        </Pressable>
      </View>

      {error && (
        <View style={s.errorBar}>
          <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
          <Text style={s.errorBarTxt}>{error}</Text>
          <Pressable onPress={fetchData}>
            <Text style={s.retryTxt}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading && records.length === 0 ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={s.loadingTxt}>Loading history…</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) =>
            typeof item === 'string'
              ? item + index
              : (item as AttendanceRecord).id + index
          }
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={s.rowSep} />}
          SectionSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles — Calendar
// ─────────────────────────────────────────────────────────────
const cal = StyleSheet.create({
  container:  { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#F3F4F6' },
  headerRow:  { flexDirection: 'row', marginBottom: 6 },
  headerCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  headerTxt:  { fontSize: 10, fontWeight: '900', color: '#9CA3AF', textTransform: 'uppercase' },
  grid:       { flexDirection: 'row', flexWrap: 'wrap' },
  cell:       { width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  filledCell: { borderRadius: 8, margin: 1 },
  dayNum:     { fontSize: 12, fontWeight: '700', color: '#374151' },
  statusDot:  { fontSize: 8, fontWeight: '900' },
  legend:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendTxt:  { fontSize: 10, color: '#6B7280' },
});

// ─────────────────────────────────────────────────────────────
// Styles — Attendance row
// ─────────────────────────────────────────────────────────────
const ar = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 10, paddingRight: 14 },
  statusBar: { width: 3, height: '80%' as any, borderRadius: 2, marginRight: 10 },
  dateCol:   { width: 88 },
  dateTxt:   { fontSize: 12, fontWeight: '700', color: '#374151' },
  timesCol:  { flex: 1, gap: 3 },
  timeChip:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeInTxt: { fontSize: 11, color: '#16A34A', fontWeight: '600' },
  timeOutTxt:{ fontSize: 11, color: '#DC2626', fontWeight: '600' },
  hoursCol:  { width: 52, alignItems: 'flex-end', marginRight: 10 },
  hoursTxt:  { fontSize: 12, fontWeight: '700', color: '#374151' },
  otTxt:     { fontSize: 9, color: '#7C3AED', fontWeight: '700' },
  badge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 64, alignItems: 'center' },
  badgeTxt:  { fontSize: 10, fontWeight: '800' },
});

// ─────────────────────────────────────────────────────────────
// Styles — Main
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },

  topBar:      { paddingTop: 52, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: '900', color: '#111827' },
  refreshBtn:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },

  monthNav:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  monthArrow: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 16, fontWeight: '900', color: '#111827' },

  errorBar:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 12, marginHorizontal: 14, marginTop: 10, padding: 10 },
  errorBarTxt: { flex: 1, fontSize: 12, color: '#DC2626' },
  errorTxt:    { fontSize: 14, color: '#DC2626' },
  retryTxt:    { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  loadingTxt:  { fontSize: 13, color: '#9CA3AF' },

  listContent: { padding: 14, paddingBottom: 60 },
  rowSep:      { height: 1, backgroundColor: '#F9FAFB', marginLeft: 14 },

  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  avatar:      { width: 56, height: 56, borderRadius: 16, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:   { fontSize: 24, fontWeight: '900', color: '#4F46E5' },
  workerName:  { fontSize: 17, fontWeight: '900', color: '#111827' },
  workerSub:   { fontSize: 12, color: '#6B7280', marginTop: 2 },
  tagRow:      { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  tag:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EEF2FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tagTxt:      { fontSize: 11, fontWeight: '700', color: '#4F46E5' },

  summaryCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#F3F4F6', justifyContent: 'space-between', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  summaryItem: { alignItems: 'center', gap: 2 },
  summaryVal:  { fontSize: 20, fontWeight: '900' },
  summaryLbl:  { fontSize: 9, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase' },

  calendarWrap: { borderRadius: 16, overflow: 'hidden' },

  sectionHeaderRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#F9FAFB' },
  sectionHeaderTxt:   { flex: 1, fontSize: 12, fontWeight: '900', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHeaderCount: { fontSize: 11, color: '#9CA3AF' },

  emptyRecords:    { alignItems: 'center', paddingVertical: 32, gap: 8, backgroundColor: '#fff' },
  emptyRecordsTxt: { fontSize: 13, color: '#9CA3AF' },

  payslipCard:  { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F3F4F6', gap: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  payslipInfo:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  payslipIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  payslipTitle: { fontSize: 15, fontWeight: '900', color: '#111827' },
  payslipSub:   { fontSize: 11, color: '#6B7280', marginTop: 2 },
  payslipBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4F46E5', borderRadius: 12, paddingVertical: 12 },
  payslipBtnTxt:{ color: '#fff', fontSize: 14, fontWeight: '700' },
});
