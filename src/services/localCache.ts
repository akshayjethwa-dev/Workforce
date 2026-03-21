// src/services/localCache.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Worker, OrgSettings } from '../types/index';

const WORKERS_PREFIX  = 'cache_workers_';
const SETTINGS_PREFIX = 'cache_settings_';
const TTL_MS          = 1000 * 60 * 30; // 30 minutes

interface CacheEntry<T> {
  data:      T;
  cachedAt:  number; // epoch ms
}

// ─────────────────────────────────────────────────────────────
// Workers
// ─────────────────────────────────────────────────────────────
export async function cacheWorkers(tenantId: string, workers: Worker[]): Promise<void> {
  try {
    const entry: CacheEntry<Worker[]> = { data: workers, cachedAt: Date.now() };
    await AsyncStorage.setItem(WORKERS_PREFIX + tenantId, JSON.stringify(entry));
  } catch (err) {
    console.error('[LocalCache] cacheWorkers failed:', err);
  }
}

export async function getCachedWorkers(tenantId: string): Promise<Worker[] | null> {
  try {
    const raw = await AsyncStorage.getItem(WORKERS_PREFIX + tenantId);
    if (!raw) return null;
    const entry: CacheEntry<Worker[]> = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > TTL_MS) return null; // expired
    return entry.data;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Org Settings
// ─────────────────────────────────────────────────────────────
export async function cacheOrgSettings(tenantId: string, settings: OrgSettings): Promise<void> {
  try {
    const entry: CacheEntry<OrgSettings> = { data: settings, cachedAt: Date.now() };
    await AsyncStorage.setItem(SETTINGS_PREFIX + tenantId, JSON.stringify(entry));
  } catch (err) {
    console.error('[LocalCache] cacheOrgSettings failed:', err);
  }
}

export async function getCachedOrgSettings(tenantId: string): Promise<OrgSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_PREFIX + tenantId);
    if (!raw) return null;
    const entry: CacheEntry<OrgSettings> = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Invalidate (call when user logs out or tenant changes)
// ─────────────────────────────────────────────────────────────
export async function invalidateCache(tenantId: string): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(WORKERS_PREFIX  + tenantId),
    AsyncStorage.removeItem(SETTINGS_PREFIX + tenantId),
  ]);
}
