// src/services/offlineQueue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'pending_punches';

export interface PendingPunch {
  id:        string;          // unique — tenantId_workerId_timestamp
  tenantId:  string;
  workerId:  string;
  workerName:string;
  date:      string;
  timestamp: string;
  type:      'IN' | 'OUT';
  device:    string;
  location?: { lat: number; lng: number };
  shiftId:   string;
  branchId?: string;
  retries:   number;
  createdAt: string;
}

// ── Add a punch to the offline queue ──────────────────────────
export async function addPendingPunch(punch: Omit<PendingPunch, 'retries' | 'createdAt'>): Promise<void> {
  try {
    const existing = await getPendingPunches();
    const updated  = [
      ...existing,
      { ...punch, retries: 0, createdAt: new Date().toISOString() },
    ];
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
    console.log(`[OfflineQueue] Queued punch for ${punch.workerName} (${punch.type})`);
  } catch (err) {
    console.error('[OfflineQueue] addPendingPunch failed:', err);
  }
}

// ── Get all pending punches ────────────────────────────────────
export async function getPendingPunches(): Promise<PendingPunch[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Remove one punch by id ─────────────────────────────────────
export async function clearPendingPunch(id: string): Promise<void> {
  try {
    const existing = await getPendingPunches();
    const updated  = existing.filter(p => p.id !== id);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('[OfflineQueue] clearPendingPunch failed:', err);
  }
}

// ── Increment retry counter (to skip permanently failing punches) ──
export async function incrementRetry(id: string): Promise<void> {
  try {
    const existing = await getPendingPunches();
    const updated  = existing.map(p => p.id === id ? { ...p, retries: p.retries + 1 } : p);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
  } catch {}
}

// ── Clear entire queue (use after full sync) ───────────────────
export async function clearAllPendingPunches(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
