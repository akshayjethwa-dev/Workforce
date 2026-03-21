// app/(admin)/payroll.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  ActivityIndicator, Modal, ScrollView, Alert,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { dbService } from '../../src/services/db';
import { wageService } from '../../src/services/wageService';
import {
  MonthlyPayroll, Worker, AttendanceRecord, Advance, OrgSettings,
} from '../../src/types/index';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const fmt  = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtK = (n: number) => n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : fmt(n);

// ─────────────────────────────────────────────────────────────
// Payroll Screen
// ─────────────────────────────────────────────────────────────
export default function PayrollScreen() {
  const { profile, limits } = useAuth();

  const now = new Date();
  const [selectedYear, setSelectedYear]   = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [pickerModal, setPickerModal]     = useState(false);

  const [workers, setWorkers]             = useState<Worker[]>([]);
  const [attendance, setAttendance]       = useState<AttendanceRecord[]>([]);
  const [advances, setAdvances]           = useState<Advance[]>([]);
  const [settings, setSettings]           = useState<OrgSettings | null>(null);
  const [savedPayrolls, setSavedPayrolls] = useState<MonthlyPayroll[]>([]);
  const [loading, setLoading]             = useState(true);
  const [exporting, setExporting]         = useState(false);

  const [detailPayroll, setDetailPayroll] = useState<MonthlyPayroll | null>(null);

  const monthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;

  // ── Load data ─────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.tenantId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [w, att, adv, s] = await Promise.all([
          dbService.getWorkers(profile.tenantId),
          dbService.getAttendanceHistory(profile.tenantId),
          dbService.getAdvances(profile.tenantId),
          dbService.getOrgSettings(profile.tenantId),
        ]);
        let saved: MonthlyPayroll[] = [];
        try {
          saved = await dbService.getPayrollsByMonth(profile.tenantId, monthStr);
        } catch { /* missing collection — silent */ }

        setWorkers(w);
        setAttendance(att);
        setAdvances(adv);
        setSettings(s);
        setSavedPayrolls(saved);
      } catch (e) {
        console.error('Payroll load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.tenantId, monthStr]);

  // ── Compute payrolls ──────────────────────────────────────
  const payrolls: MonthlyPayroll[] = useMemo(() => {
    if (!workers.length || !settings) return [];
    return workers.map((worker) => {
      const saved = savedPayrolls.find((p) => p.workerId === worker.id);
      if (saved) return saved;
      return wageService.generateMonthlyPayroll(
        worker, monthStr, attendance, advances, settings,
      );
    });
  }, [workers, attendance, advances, savedPayrolls, monthStr, settings]);

  // ── Summary totals ────────────────────────────────────────
  const pendingTotal = payrolls
    .filter((p) => p.status !== 'PAID')
    .reduce((s, p) => s + p.netPayable, 0);
  const paidTotal = payrolls
    .filter((p) => p.status === 'PAID')
    .reduce((s, p) => s + p.netPayable, 0);

  // ── Mark as paid ──────────────────────────────────────────
  const handleMarkPaid = useCallback(async (payroll: MonthlyPayroll) => {
    Alert.alert(
      'Mark as Paid',
      `Mark ${fmt(payroll.netPayable)} as paid to ${payroll.workerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              // ✅ FIX 1: narrow undefined with ?? 0
              const carryFwd = payroll.carriedForwardAdvance ?? 0;
              if (carryFwd > 0) {
                const [y, m] = monthStr.split('-');
                let nm = parseInt(m) + 1, ny = parseInt(y);
                if (nm > 12) { nm = 1; ny++; }
                const nextMs = `${ny}-${String(nm).padStart(2, '0')}-01`;
                await dbService.addAdvance({
                  tenantId: profile!.tenantId,
                  workerId: payroll.workerId,
                  amount: carryFwd,            // ✅ definitely number
                  date: nextMs,
                  reason: 'Carry Forward from Previous Month',
                  status: 'APPROVED',
                });
              }
              const updated: MonthlyPayroll = { ...payroll, status: 'PAID' };
              await dbService.savePayroll(updated);
              setSavedPayrolls((prev) => {
                const exists = prev.find((p) => p.id === updated.id);
                return exists
                  ? prev.map((p) => (p.id === updated.id ? updated : p))
                  : [...prev, updated];
              });
            } catch {
              Alert.alert('Error', 'Failed to save. Check Firestore rules.');
            }
          },
        },
      ],
    );
  }, [monthStr, profile]);

  // ── PDF Export ────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!payrolls.length) return;
    setExporting(true);
    try {
      const rows = payrolls.map((p) => `
        <tr>
          <td>${p.workerName}</td>
          <td>${p.workerDepartment ?? '-'}</td>
          <td>${p.attendanceSummary.presentDays}</td>
          <td>${p.attendanceSummary.halfDays}</td>
          <td>${p.attendanceSummary.absentDays}</td>
          <td>${p.attendanceSummary.paidLeaves ?? 0}</td>
          <td>${p.attendanceSummary.totalOvertimeHours}h</td>
          <td>₹${p.earnings.gross.toLocaleString('en-IN')}</td>
          <td>₹${p.deductions.advances.toLocaleString('en-IN')}</td>
          <td><strong>₹${p.netPayable.toLocaleString('en-IN')}</strong></td>
          <td>${p.status === 'PAID' ? '✓ PAID' : 'PENDING'}</td>
        </tr>`).join('');

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; font-size: 12px; }
            h1 { font-size: 20px; margin-bottom: 4px; color: #111; }
            p  { color: #666; margin: 0 0 16px; font-size: 11px; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #1e40af; color: #fff; padding: 8px 6px; text-align: left; font-size: 11px; }
            td { padding: 7px 6px; border-bottom: 1px solid #e5e7eb; }
            tr:nth-child(even) td { background: #f9fafb; }
            .summary { display: flex; gap: 24px; margin-bottom: 20px; }
            .scard { background: #f3f4f6; border-radius: 8px; padding: 12px 18px; }
            .scard p { font-size: 11px; color: #6b7280; margin: 0; }
            .scard h2 { font-size: 18px; font-weight: 700; margin: 4px 0 0; }
            .green { color: #16a34a; }
            .orange { color: #ea580c; }
          </style>
        </head>
        <body>
          <h1>${profile?.companyName ?? 'WorkforcePro'} — Payroll Report</h1>
          <p>${MONTHS[selectedMonth]} ${selectedYear} · Generated on ${new Date().toLocaleDateString('en-IN')}</p>
          <div class="summary">
            <div class="scard"><p>Total Paid</p><h2 class="green">₹${paidTotal.toLocaleString('en-IN')}</h2></div>
            <div class="scard"><p>Pending Payout</p><h2 class="orange">₹${pendingTotal.toLocaleString('en-IN')}</h2></div>
            <div class="scard"><p>Total Workers</p><h2>${payrolls.length}</h2></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Worker</th><th>Dept</th><th>P</th><th>HD</th><th>A</th>
                <th>Leave</th><th>OT</th><th>Gross</th><th>Deductions</th>
                <th>Net Pay</th><th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
        </html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Payroll ${MONTHS[selectedMonth]} ${selectedYear}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      console.error('Export error:', e);
      Alert.alert('Export Failed', 'Could not generate PDF.');
    } finally {
      setExporting(false);
    }
  }, [payrolls, selectedMonth, selectedYear, paidTotal, pendingTotal, profile]);

  // ── Worker card ───────────────────────────────────────────
  const renderCard = useCallback(({ item: p }: { item: MonthlyPayroll }) => {
    const isPaid = p.status === 'PAID';
    return (
      <Pressable
        style={s.card}
        onPress={() => {
          if (!(limits as any)?.payslipEnabled) {
            Alert.alert('Premium Feature', 'Detailed payslips require a premium plan. Please upgrade.');
            return;
          }
          setDetailPayroll(p);
        }}
      >
        <View style={s.cardRow}>
          <View style={s.avatarWrap}>
            <Text style={s.avatarTxt}>{p.workerName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.workerName}>{p.workerName}</Text>
            <Text style={s.workerDept}>{p.workerDepartment ?? p.workerDesignation ?? '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.netPay}>{fmt(p.netPayable)}</Text>
            <View style={[s.statusBadge, isPaid ? s.badgePaid : s.badgePending]}>
              <Ionicons
                name={isPaid ? 'checkmark-circle' : 'time-outline'}
                size={10}
                color={isPaid ? '#16A34A' : '#EA580C'}
              />
              <Text style={[s.statusBadgeTxt, { color: isPaid ? '#16A34A' : '#EA580C' }]}>
                {isPaid ? 'PAID' : 'PENDING'}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.chipRow}>
          <AttChip label="P"  value={p.attendanceSummary.presentDays}  color="#16A34A" />
          {p.attendanceSummary.halfDays > 0 && (
            <AttChip label="HD" value={p.attendanceSummary.halfDays} color="#D97706" />
          )}
          {p.attendanceSummary.absentDays > 0 && (
            <AttChip label="A"  value={p.attendanceSummary.absentDays}  color="#DC2626" />
          )}
          {(p.attendanceSummary.paidLeaves ?? 0) > 0 && (
            <AttChip label="L"  value={p.attendanceSummary.paidLeaves!} color="#7C3AED" />
          )}
          <AttChip label="OT" value={`${p.attendanceSummary.totalOvertimeHours}h`} color="#2563EB" />
        </View>

        <View style={[s.cardRow, { marginTop: 10 }]}>
          <View style={s.earningsRow}>
            <Text style={s.earningsLabel}>Gross</Text>
            <Text style={s.earningsVal}>{fmt(p.earnings.gross)}</Text>
            {p.deductions.advances > 0 && (
              <>
                <Text style={[s.earningsLabel, { marginLeft: 12 }]}>Deduct</Text>
                <Text style={[s.earningsVal, { color: '#DC2626' }]}>
                  -{fmt(p.deductions.advances)}
                </Text>
              </>
            )}
          </View>
          {!isPaid && (
            <Pressable style={s.markPaidBtn} onPress={() => handleMarkPaid(p)}>
              <Text style={s.markPaidTxt}>Mark Paid</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  }, [limits, handleMarkPaid]);

  // ── Guards ────────────────────────────────────────────────
  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color="#4F46E5" />
      <Text style={s.loadingTxt}>Loading payroll...</Text>
    </View>
  );

  // ─────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Payroll</Text>
          <Pressable style={s.monthPill} onPress={() => setPickerModal(true)}>
            <Ionicons name="calendar-outline" size={13} color="#4F46E5" />
            <Text style={s.monthPillTxt}>{MONTHS[selectedMonth]} {selectedYear}</Text>
            <Ionicons name="chevron-down" size={13} color="#4F46E5" />
          </Pressable>
        </View>
        <Pressable
          style={[s.exportBtn, exporting && { opacity: 0.6 }]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="share-outline" size={16} color="#fff" />
          }
          <Text style={s.exportBtnTxt}>{exporting ? 'Exporting...' : 'Export PDF'}</Text>
        </Pressable>
      </View>

      {/* Summary */}
      <View style={s.summaryRow}>
        <SummaryCard label="Pending Payout" value={fmtK(pendingTotal)} color="#EA580C" icon="time-outline" />
        <SummaryCard label="Total Paid"     value={fmtK(paidTotal)}    color="#16A34A" icon="checkmark-circle-outline" />
      </View>

      {/* List */}
      <FlatList
        data={payrolls}
        keyExtractor={(p) => p.id}
        renderItem={renderCard}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
            <Text style={s.emptyTxt}>No workers found for this month.</Text>
          </View>
        }
      />

      {/* Month picker */}
      <Modal visible={pickerModal} transparent animationType="slide" onRequestClose={() => setPickerModal(false)}>
        <View style={s.pickerOverlay}>
          <View style={s.pickerCard}>
            <Text style={s.pickerTitle}>Select Month</Text>
            <View style={s.yearRow}>
              <Pressable onPress={() => setSelectedYear((y) => y - 1)}>
                <Ionicons name="chevron-back" size={22} color="#374151" />
              </Pressable>
              <Text style={s.yearTxt}>{selectedYear}</Text>
              <Pressable onPress={() => setSelectedYear((y) => y + 1)}>
                <Ionicons name="chevron-forward" size={22} color="#374151" />
              </Pressable>
            </View>
            <View style={s.monthGrid}>
              {MONTHS.map((m, i) => (
                <Pressable
                  key={m}
                  style={[s.monthBtn, i === selectedMonth && s.monthBtnActive]}
                  onPress={() => { setSelectedMonth(i); setPickerModal(false); }}
                >
                  <Text style={[s.monthBtnTxt, i === selectedMonth && s.monthBtnTxtActive]}>
                    {m.slice(0, 3)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.pickerClose} onPress={() => setPickerModal(false)}>
              <Text style={s.pickerCloseTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Detail modal */}
      {detailPayroll && (
        <DetailModal
          payroll={detailPayroll}
          onClose={() => setDetailPayroll(null)}
          onMarkPaid={() => { handleMarkPaid(detailPayroll); setDetailPayroll(null); }}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
function SummaryCard({ label, value, color, icon }: {
  label: string; value: string; color: string; icon: any;
}) {
  return (
    <View style={s.summaryCard}>
      <View style={[s.summaryIconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryVal, { color }]}>{value}</Text>
    </View>
  );
}

function AttChip({ label, value, color }: {
  label: string; value: string | number; color: string;
}) {
  return (
    <View style={[s.chip, { backgroundColor: color + '15' }]}>
      <Text style={[s.chipTxt, { color }]}>{label} {value}</Text>
    </View>
  );
}

function DetailModal({ payroll: p, onClose, onMarkPaid }: {
  payroll: MonthlyPayroll;
  onClose: () => void;
  onMarkPaid: () => void;
}) {
  const isPaid   = p.status === 'PAID';
  // ✅ FIX 2 & 3: ?? 0 on all carriedForwardAdvance reads
  const carryFwd = p.carriedForwardAdvance ?? 0;

  const rows: [string, string][] = [
    ['Present Days',    String(p.attendanceSummary.presentDays)],
    ['Half Days',       String(p.attendanceSummary.halfDays)],
    ['Absent Days',     String(p.attendanceSummary.absentDays)],
    ['Paid Leaves',     String(p.attendanceSummary.paidLeaves ?? 0)],
    ['Unpaid Leaves',   String(p.attendanceSummary.unpaidLeaves ?? 0)],
    ['Weekly Offs',     String(p.attendanceSummary.weeklyOffs)],
    ['Public Holidays', String(p.attendanceSummary.publicHolidays)],
    ['OT Hours',        `${p.attendanceSummary.totalOvertimeHours}h`],
    ['Payable Days',    String(p.attendanceSummary.payableDays)],
    ['─────────────',  '─────'],
    ['Basic Pay',       `₹${p.earnings.basic.toLocaleString('en-IN')}`],
    ['OT Pay',          `₹${p.earnings.overtime.toLocaleString('en-IN')}`],
    ['Allowances',      `₹${p.earnings.allowances.other.toLocaleString('en-IN')}`],
    ['Gross Pay',       `₹${p.earnings.gross.toLocaleString('en-IN')}`],
    ['─────────────',  '─────'],
    ['Advances',        `₹${p.deductions.advances.toLocaleString('en-IN')}`],
    ['Total Deductions',`₹${p.deductions.total.toLocaleString('en-IN')}`],
    ...(carryFwd > 0
      ? [['Carry Forward', `₹${carryFwd.toLocaleString('en-IN')}`] as [string, string]]
      : []),
    ['─────────────',  '─────'],
    ['NET PAYABLE',     `₹${p.netPayable.toLocaleString('en-IN')}`],
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.detailOverlay}>
        <View style={s.detailCard}>
          <View style={s.detailHeader}>
            <View>
              <Text style={s.detailName}>{p.workerName}</Text>
              <Text style={s.detailDept}>{p.workerDepartment ?? p.workerDesignation ?? '—'}</Text>
            </View>
            <Pressable onPress={onClose} style={s.detailClose}>
              <Ionicons name="close" size={20} color="#374151" />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {rows.map(([label, val], i) => {
              const isSep   = label.startsWith('──');
              const isTotal = label === 'NET PAYABLE';
              return (
                <View key={i} style={[
                  s.detailRow,
                  isSep   && { borderBottomWidth: 0, paddingVertical: 2 },
                  isTotal && { backgroundColor: '#EFF6FF', borderRadius: 8, marginTop: 4 },
                ]}>
                  {!isSep && (
                    <>
                      <Text style={[s.detailLabel, isTotal && { fontWeight: '800', color: '#1D4ED8' }]}>
                        {label}
                      </Text>
                      <Text style={[s.detailVal, isTotal && { fontWeight: '800', color: '#1D4ED8', fontSize: 16 }]}>
                        {val}
                      </Text>
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={s.detailFooter}>
            {!isPaid ? (
              <Pressable style={s.markPaidBtnLg} onPress={onMarkPaid}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={s.markPaidLgTxt}>Mark as Paid</Text>
              </Pressable>
            ) : (
              <View style={s.paidBanner}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                <Text style={s.paidBannerTxt}>Payment completed</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#F9FAFB' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTxt: { color: '#6B7280', fontSize: 14 },

  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title:        { fontSize: 22, fontWeight: '900', color: '#111827' },
  monthPill:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EEF2FF', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginTop: 6 },
  monthPillTxt: { color: '#4F46E5', fontSize: 12, fontWeight: '700' },
  exportBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#4F46E5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  exportBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },

  summaryRow:      { flexDirection: 'row', gap: 12, padding: 16 },
  summaryCard:     { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#F3F4F6', gap: 4 },
  summaryIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  summaryLabel:    { color: '#6B7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  summaryVal:      { fontSize: 20, fontWeight: '900' },

  card:         { backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#F3F4F6' },
  cardRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap:   { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:    { fontSize: 17, fontWeight: '900', color: '#4F46E5' },
  workerName:   { fontSize: 15, fontWeight: '800', color: '#111827' },
  workerDept:   { fontSize: 12, color: '#6B7280', marginTop: 1 },
  netPay:       { fontSize: 17, fontWeight: '900', color: '#111827' },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginTop: 3 },
  badgePaid:    { backgroundColor: '#DCFCE7' },
  badgePending: { backgroundColor: '#FFF7ED' },
  statusBadgeTxt: { fontSize: 10, fontWeight: '800' },

  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip:       { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt:    { fontSize: 11, fontWeight: '800' },

  earningsRow:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9FAFB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  earningsLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
  earningsVal:   { fontSize: 12, fontWeight: '800', color: '#374151' },
  markPaidBtn:   { backgroundColor: '#4F46E5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  markPaidTxt:   { color: '#fff', fontSize: 12, fontWeight: '800' },

  empty:    { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTxt: { color: '#9CA3AF', fontSize: 14 },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerCard:    { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  pickerTitle:   { fontSize: 17, fontWeight: '900', color: '#111827', textAlign: 'center', marginBottom: 16 },
  yearRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 },
  yearTxt:       { fontSize: 20, fontWeight: '800', color: '#111827' },
  monthGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  monthBtn:      { width: '22%', paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  monthBtnActive:    { backgroundColor: '#4F46E5' },
  monthBtnTxt:       { fontSize: 13, fontWeight: '700', color: '#374151' },
  monthBtnTxtActive: { color: '#fff' },
  pickerClose:    { marginTop: 20, alignItems: 'center', paddingVertical: 14 },
  pickerCloseTxt: { color: '#6B7280', fontSize: 14, fontWeight: '600' },

  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  detailCard:    { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', paddingBottom: 0 },
  detailHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  detailName:    { fontSize: 18, fontWeight: '900', color: '#111827' },
  detailDept:    { fontSize: 13, color: '#6B7280', marginTop: 2 },
  detailClose:   { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  detailRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  detailLabel:   { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  detailVal:     { fontSize: 14, color: '#111827', fontWeight: '700' },
  detailFooter:  { padding: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  markPaidBtnLg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4F46E5', borderRadius: 14, paddingVertical: 14 },
  markPaidLgTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  paidBanner:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#DCFCE7', borderRadius: 14, paddingVertical: 14 },
  paidBannerTxt: { color: '#16A34A', fontSize: 15, fontWeight: '800' },
});
