// app/(admin)/id-cards.tsx
// Task 19: ID Cards Screen (Expo React Native)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  Modal, ScrollView, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Print   from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'react-native-qrcode-svg';
import { useAuth }   from './../../src/contexts/AuthContext';
import { dbService } from './../../src/services/db';
import { Worker }    from './../../src/types/index';


// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const BRAND = {
  primary:   '#4F46E5',
  secondary: '#6366F1',
  light:     '#EEF2FF',
  dark:      '#1E1B4B',
  accent:    '#A5B4FC',
  text:      '#111827',
  sub:       '#6B7280',
};


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function avatarBg(name: string): string {
  const COLORS = ['#4F46E5','#7C3AED','#0D9488','#D97706','#DC2626','#059669','#2563EB'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function qrValue(worker: Worker, tenantId: string): string {
  return JSON.stringify({
    workerId: worker.id,
    tenantId,
    name:     worker.name,
    emp:      (worker as any).employeeId ?? worker.id,
  });
}


// ─────────────────────────────────────────────────────────────
// HTML ID Cards generator for print (2 cards per row)
// ─────────────────────────────────────────────────────────────
function buildIDCardsHTML(params: {
  workers:   Worker[];
  tenantId:  string;
  orgName:   string;
}): string {
  const { workers, tenantId, orgName } = params;

  const cardHTML = workers.map((w) => {
    const initials  = getInitials(w.name);
    const bg        = avatarBg(w.name);
    const empId     = (w as any).employeeId ?? w.id?.slice(0, 8).toUpperCase() ?? '—';
    const dept      = (w as any).department ?? '—';
    const desig     = (w as any).designation ?? '—';
    const qrData    = qrValue(w, tenantId);
    const qrUrl     = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(qrData)}`;

    return `
<div class="card">
  <div class="card-header">
    <div class="org-logo">${orgName.slice(0, 2).toUpperCase()}</div>
    <div class="org-name">${orgName}</div>
    <div class="org-tag">EMPLOYEE ID CARD</div>
  </div>
  <div class="card-body">
    <div class="avatar" style="background:${bg}">${initials}</div>
    <div class="worker-name">${w.name}</div>
    <div class="worker-desig">${desig}</div>
    <div class="divider"></div>
    <div class="info-row"><span class="info-label">EMP ID</span><span class="info-val">${empId}</span></div>
    <div class="info-row"><span class="info-label">DEPT</span><span class="info-val">${dept}</span></div>
    <div class="qr-wrap">
      <img src="${qrUrl}" width="72" height="72" alt="QR"/>
    </div>
  </div>
  <div class="card-footer">
    <span>${orgName}</span>
    <span>workforcepro.app</span>
  </div>
</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background: #f3f4f6; padding: 20px; }
  h1 { font-size: 14px; color: #6B7280; margin-bottom: 16px; text-align:center; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }

  .card {
    width: 280px; border-radius: 16px; overflow: hidden;
    box-shadow: 0 4px 16px rgba(79,70,229,0.15);
    background: #fff; page-break-inside: avoid;
  }
  .card-header {
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
    padding: 14px 16px 10px; text-align: center;
  }
  .org-logo {
    width: 36px; height: 36px; border-radius: 10px;
    background: rgba(255,255,255,0.2); color: #fff;
    font-size: 14px; font-weight: 900; display: inline-flex;
    align-items: center; justify-content: center; margin-bottom: 4px;
  }
  .org-name { font-size: 13px; font-weight: 900; color: #fff; letter-spacing: 0.5px; }
  .org-tag  { font-size: 9px; color: rgba(255,255,255,0.7); letter-spacing: 1.5px; margin-top: 2px; }

  .card-body { padding: 16px; text-align: center; }
  .avatar {
    width: 64px; height: 64px; border-radius: 20px;
    color: #fff; font-size: 22px; font-weight: 900;
    display: inline-flex; align-items: center; justify-content: center;
    margin-bottom: 10px; border: 3px solid #EEF2FF;
  }
  .worker-name  { font-size: 15px; font-weight: 900; color: #111827; }
  .worker-desig { font-size: 11px; color: #6B7280; margin-top: 2px; }
  .divider { height: 1px; background: #F3F4F6; margin: 10px 0; }
  .info-row {
    display: flex; justify-content: space-between;
    padding: 3px 0; font-size: 11px;
  }
  .info-label { color: #9CA3AF; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-val   { color: #111827; font-weight: 700; }
  .qr-wrap { margin-top: 12px; display: flex; justify-content: center; }
  .qr-wrap img { border-radius: 8px; border: 2px solid #EEF2FF; }

  .card-footer {
    background: #1E1B4B; padding: 8px 16px;
    display: flex; justify-content: space-between;
    font-size: 9px; color: rgba(255,255,255,0.6);
  }

  @media print {
    body { background: #fff; padding: 10px; }
    .card { box-shadow: none; border: 1px solid #E5E7EB; }
  }
</style>
</head>
<body>
<h1>ID Cards — ${orgName} · ${workers.length} cards</h1>
<div class="grid">${cardHTML}</div>
</body>
</html>`;
}


// ─────────────────────────────────────────────────────────────
// In-app ID Card preview component
// ─────────────────────────────────────────────────────────────
function IDCardPreview({
  worker, orgName, tenantId,
}: {
  worker: Worker; orgName: string; tenantId: string;
}) {
  const initials = getInitials(worker.name);
  const bg       = avatarBg(worker.name);
  const empId    = (worker as any).employeeId ?? worker.id?.slice(0, 8).toUpperCase() ?? '—';
  const dept     = (worker as any).department  ?? '—';
  const desig    = (worker as any).designation ?? '—';

  return (
    <View style={card.root}>
      {/* Header */}
      <View style={card.header}>
        <View style={card.orgLogoBox}>
          <Text style={card.orgLogoTxt}>{orgName.slice(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={card.orgName}>{orgName}</Text>
        <Text style={card.orgTag}>EMPLOYEE ID CARD</Text>
      </View>

      {/* Body */}
      <View style={card.body}>
        <View style={[card.avatar, { backgroundColor: bg }]}>
          <Text style={card.avatarTxt}>{initials}</Text>
        </View>

        <Text style={card.workerName}>{worker.name}</Text>
        <Text style={card.workerDesig}>{desig}</Text>

        <View style={card.divider} />

        <View style={card.infoRow}>
          <Text style={card.infoLabel}>EMP ID</Text>
          <Text style={card.infoVal}>{empId}</Text>
        </View>
        <View style={card.infoRow}>
          <Text style={card.infoLabel}>DEPT</Text>
          <Text style={card.infoVal}>{dept}</Text>
        </View>
        {(worker as any).branch && (
          <View style={card.infoRow}>
            <Text style={card.infoLabel}>BRANCH</Text>
            <Text style={card.infoVal}>{(worker as any).branch}</Text>
          </View>
        )}

        {/* QR Code */}
        <View style={card.qrWrap}>
          <QRCode
            value={qrValue(worker, tenantId)}
            size={80}
            color={BRAND.dark}
            backgroundColor="#fff"
          />
        </View>
        <Text style={card.qrHint}>Scan to verify</Text>
      </View>

      {/* Footer */}
      <View style={card.footer}>
        <Text style={card.footerTxt}>{orgName}</Text>
        <Text style={card.footerTxt}>workforcepro.app</Text>
      </View>
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// Worker list row
// ─────────────────────────────────────────────────────────────
function WorkerRow({
  worker, selected, onToggle, onPreview,
}: {
  worker:    Worker;
  selected:  boolean;
  onToggle:  () => void;
  onPreview: () => void;
}) {
  const initials = getInitials(worker.name);
  const bg       = avatarBg(worker.name);
  const dept     = (worker as any).department ?? (worker as any).designation ?? '—';
  const empId    = (worker as any).employeeId ?? worker.id?.slice(0, 8).toUpperCase();

  return (
    <Pressable style={[wr.row, selected && wr.rowSelected]} onPress={onToggle}>
      {/* Checkbox */}
      <View style={[wr.checkbox, selected && wr.checkboxOn]}>
        {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>

      {/* Avatar */}
      <View style={[wr.avatar, { backgroundColor: bg }]}>
        <Text style={wr.avatarTxt}>{initials}</Text>
      </View>

      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text style={wr.name}>{worker.name}</Text>
        <Text style={wr.sub}>{dept} · {empId}</Text>
      </View>

      {/* Preview button */}
      <Pressable style={wr.previewBtn} onPress={onPreview} hitSlop={10}>
        <Ionicons name="eye-outline" size={16} color={BRAND.primary} />
      </Pressable>
    </Pressable>
  );
}


// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function IDCardsScreen() {
  const { profile } = useAuth();
  const router      = useRouter();

  const [workers,       setWorkers]       = useState<Worker[]>([]);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [printing,      setPrinting]      = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [orgName,       setOrgName]       = useState('WorkforcePro');
  const [previewWorker, setPreviewWorker] = useState<Worker | null>(null);

  // ── Fetch workers ────────────────────────────────────────
  const fetchWorkers = useCallback(async () => {
    if (!profile?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [all, tenant] = await Promise.all([
        dbService.getWorkers(profile.tenantId),
        dbService.getTenant(profile.tenantId),
      ]);
      const active = all.filter((w: any) => w.status !== 'INACTIVE' && w.isActive !== false);
      setWorkers(active);
      if (tenant?.name) setOrgName(tenant.name);
    } catch (err: any) {
      setError('Failed to load workers.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenantId]);

  useEffect(() => { fetchWorkers(); }, [fetchWorkers]);

  // ── Selection logic ──────────────────────────────────────
  const allSelected  = workers.length > 0 && selected.size === workers.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(workers.map((w) => w.id)));
    }
  };

  const toggleWorker = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedWorkers = useMemo(
    () => workers.filter((w) => selected.has(w.id)),
    [workers, selected],
  );

  // ── Print / Export ───────────────────────────────────────
  const handlePrint = async () => {
    if (selectedWorkers.length === 0) {
      Alert.alert('No workers selected', 'Please select at least one worker.');
      return;
    }
    setPrinting(true);
    try {
      const html = buildIDCardsHTML({
        workers:  selectedWorkers,
        tenantId: profile!.tenantId,
        orgName,
      });

      if (Platform.OS === 'web') {
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.print(); }
        return;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType:    'application/pdf',
          dialogTitle: `ID Cards — ${orgName}`,
          UTI:         'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to generate ID cards.');
    } finally {
      setPrinting(false);
    }
  };

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
          <Text style={s.topBarTitle}>ID Cards</Text>
          <Text style={s.topBarSub}>
            {loading ? 'Loading…' : `${workers.length} workers · ${selected.size} selected`}
          </Text>
        </View>
        <Pressable style={s.refreshBtn} onPress={fetchWorkers} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={BRAND.primary} />
            : <Ionicons name="refresh-outline" size={20} color={BRAND.primary} />
          }
        </Pressable>
      </View>

      {/* ── Toolbar ── */}
      <View style={s.toolbar}>
        <Pressable style={s.selectAllBtn} onPress={toggleSelectAll}>
          <View style={[
            s.checkbox,
            allSelected  && s.checkboxOn,
            someSelected && s.checkboxPartial,
          ]}>
            {allSelected  && <Ionicons name="checkmark" size={12} color="#fff" />}
            {someSelected && <View style={s.partialDot} />}
          </View>
          <Text style={s.selectAllTxt}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </Text>
        </Pressable>

        <Pressable
          style={[s.printBtn, (printing || selected.size === 0) && { opacity: 0.5 }]}
          onPress={handlePrint}
          disabled={printing || selected.size === 0}
        >
          {printing
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="print-outline" size={16} color="#fff" />
          }
          <Text style={s.printBtnTxt}>
            {printing
              ? 'Generating…'
              : `Print / Export${selected.size > 0 ? ` (${selected.size})` : ''}`
            }
          </Text>
        </Pressable>
      </View>

      {/* ── Error ── */}
      {error && (
        <View style={s.errorBar}>
          <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
          <Text style={s.errorBarTxt}>{error}</Text>
          <Pressable onPress={fetchWorkers}>
            <Text style={s.retryTxt}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* ── Worker list ── */}
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={BRAND.primary} />
          <Text style={s.loadingTxt}>Loading workers…</Text>
        </View>
      ) : workers.length === 0 ? (
        <View style={s.centered}>
          <Ionicons name="people-outline" size={48} color="#E5E7EB" />
          <Text style={s.emptyTxt}>No active workers found.</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {workers.map((item, index) => (
            <React.Fragment key={item.id}>
              <WorkerRow
                worker={item}
                selected={selected.has(item.id)}
                onToggle={() => toggleWorker(item.id)}
                onPreview={() => setPreviewWorker(item)}
              />
              {index < workers.length - 1 && <View style={s.sep} />}
            </React.Fragment>
          ))}
        </ScrollView>
      )}

      {/* ── Preview Modal ── */}
      <Modal
        visible={!!previewWorker}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewWorker(null)}
      >
        <View style={modal.overlay}>
          <View style={modal.sheet}>
            {/* Modal header */}
            <View style={modal.header}>
              <Text style={modal.headerTxt}>ID Card Preview</Text>
              <Pressable style={modal.closeBtn} onPress={() => setPreviewWorker(null)}>
                <Ionicons name="close" size={20} color="#374151" />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={modal.body}
              showsVerticalScrollIndicator={false}
            >
              {previewWorker && (
                <IDCardPreview
                  worker={previewWorker}
                  orgName={orgName}
                  tenantId={profile?.tenantId ?? ''}
                />
              )}

              {/* Actions */}
              <View style={modal.actions}>
                <Pressable
                  style={[
                    modal.actionBtn,
                    selected.has(previewWorker?.id ?? '') && modal.actionBtnSelected,
                  ]}
                  onPress={() => {
                    if (previewWorker) toggleWorker(previewWorker.id);
                  }}
                >
                  <Ionicons
                    name={selected.has(previewWorker?.id ?? '') ? 'checkmark-circle' : 'add-circle-outline'}
                    size={16}
                    color={selected.has(previewWorker?.id ?? '') ? '#16A34A' : BRAND.primary}
                  />
                  <Text style={[
                    modal.actionBtnTxt,
                    selected.has(previewWorker?.id ?? '') && { color: '#16A34A' },
                  ]}>
                    {selected.has(previewWorker?.id ?? '') ? 'Selected' : 'Add to selection'}
                  </Text>
                </Pressable>

                <Pressable
                  style={[modal.actionBtn, modal.printSingleBtn]}
                  onPress={async () => {
                    if (!previewWorker) return;
                    setPreviewWorker(null);
                    setPrinting(true);
                    try {
                      const html = buildIDCardsHTML({
                        workers:  [previewWorker],
                        tenantId: profile!.tenantId,
                        orgName,
                      });
                      if (Platform.OS === 'web') {
                        const win = window.open('', '_blank');
                        if (win) { win.document.write(html); win.document.close(); win.print(); }
                        return;
                      }
                      const { uri } = await Print.printToFileAsync({ html, base64: false });
                      if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(uri, {
                          mimeType: 'application/pdf',
                          dialogTitle: `ID Card — ${previewWorker.name}`,
                          UTI: 'com.adobe.pdf',
                        });
                      } else {
                        await Print.printAsync({ uri });
                      }
                    } catch (err: any) {
                      Alert.alert('Error', err?.message ?? 'Failed.');
                    } finally {
                      setPrinting(false);
                    }
                  }}
                >
                  <Ionicons name="print-outline" size={16} color="#fff" />
                  <Text style={modal.printSingleTxt}>Print This Card</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}


// ─────────────────────────────────────────────────────────────
// ID Card preview styles
// ─────────────────────────────────────────────────────────────
const card = StyleSheet.create({
  root:       { width: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff', shadowColor: BRAND.primary, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 },
  header:     { backgroundColor: BRAND.primary, paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center' },
  orgLogoBox: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  orgLogoTxt: { fontSize: 15, fontWeight: '900', color: '#fff' },
  orgName:    { fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  orgTag:     { fontSize: 9, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5, marginTop: 2 },

  body:        { paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center' },
  avatar:      { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 10, borderWidth: 3, borderColor: BRAND.light },
  avatarTxt:   { fontSize: 24, fontWeight: '900', color: '#fff' },
  workerName:  { fontSize: 16, fontWeight: '900', color: BRAND.text, textAlign: 'center' },
  workerDesig: { fontSize: 11, color: BRAND.sub, marginTop: 2 },

  divider: { height: 1, backgroundColor: '#F3F4F6', width: '100%', marginVertical: 10 },

  infoRow:   { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 3 },
  infoLabel: { fontSize: 10, fontWeight: '900', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoVal:   { fontSize: 11, fontWeight: '700', color: BRAND.text },

  qrWrap: { marginTop: 12, padding: 6, backgroundColor: '#fff', borderRadius: 10, borderWidth: 2, borderColor: BRAND.light },
  qrHint: { fontSize: 9, color: '#9CA3AF', marginTop: 6 },

  footer:    { backgroundColor: BRAND.dark, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt: { fontSize: 9, color: 'rgba(255,255,255,0.6)' },
});


// ─────────────────────────────────────────────────────────────
// Worker row styles
// ─────────────────────────────────────────────────────────────
const wr = StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  rowSelected: { backgroundColor: '#F5F3FF' },
  checkbox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  checkboxOn:  { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  avatar:      { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:   { fontSize: 16, fontWeight: '900', color: '#fff' },
  name:        { fontSize: 14, fontWeight: '700', color: '#111827' },
  sub:         { fontSize: 11, color: '#6B7280', marginTop: 2 },
  previewBtn:  { width: 36, height: 36, borderRadius: 10, backgroundColor: BRAND.light, alignItems: 'center', justifyContent: 'center' },
});


// ─────────────────────────────────────────────────────────────
// Modal styles
// ─────────────────────────────────────────────────────────────
const modal = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: '#F9FAFB', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  headerTxt:  { fontSize: 16, fontWeight: '900', color: '#111827' },
  closeBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  body:       { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, gap: 16 },
  actions:    { width: '100%', gap: 10, marginTop: 4 },
  actionBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BRAND.light, borderRadius: 12, paddingVertical: 12 },
  actionBtnSelected: { backgroundColor: '#DCFCE7' },
  actionBtnTxt:      { fontSize: 14, fontWeight: '700', color: BRAND.primary },
  printSingleBtn:    { backgroundColor: BRAND.primary },
  printSingleTxt:    { fontSize: 14, fontWeight: '700', color: '#fff' },
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

  toolbar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 10 },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  checkboxOn:   { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  checkboxPartial: { borderColor: BRAND.primary },
  partialDot:   { width: 10, height: 10, borderRadius: 2, backgroundColor: BRAND.primary },
  selectAllTxt: { fontSize: 13, fontWeight: '700', color: '#374151' },
  printBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BRAND.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  printBtnTxt:  { fontSize: 13, fontWeight: '700', color: '#fff' },

  errorBar:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 12, marginHorizontal: 14, marginTop: 10, padding: 10 },
  errorBarTxt: { flex: 1, fontSize: 12, color: '#DC2626' },
  retryTxt:    { fontSize: 12, fontWeight: '800', color: '#DC2626' },
  loadingTxt:  { fontSize: 13, color: '#9CA3AF' },
  emptyTxt:    { fontSize: 14, color: '#9CA3AF' },

  listContent: { paddingBottom: 40 },
  sep:         { height: 1, backgroundColor: '#F3F4F6', marginLeft: 14 },
});
