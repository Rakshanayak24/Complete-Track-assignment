import { Account, Page, StoredState, Transaction } from './types';
import { normalizeTransaction } from './normalize';
import { Platform } from 'react-native';

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };
export const emptyState: StoredState = { transactions: [], accounts: [], syncToken: null, lastSyncedAt: null, hasSynced: false };
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;
export const API_URL = Platform.OS === 'web' && (!configuredApiUrl || configuredApiUrl === 'http://10.0.2.2:4010')
  ? 'http://localhost:4010'
  : configuredApiUrl ?? 'http://10.0.2.2:4010';

class ApiError extends Error { constructor(public status: number) { super(`Server returned ${status}`); } }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function getJson<T>(url: string, signal?: AbortSignal, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) return await response.json() as T;
      const error = new ApiError(response.status);
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) throw error;
      const retryAfter = Number(response.headers.get('Retry-After'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 4000));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted || attempt === attempts - 1) throw error;
      lastError = error;
      await wait(Math.min(500 * 2 ** attempt, 4000));
    }
  }
  throw lastError ?? new Error('Request failed');
}
function newer(a: Transaction, b: Transaction): Transaction {
  return Date.parse(b.updated_at ?? b.occurred_at) >= Date.parse(a.updated_at ?? a.occurred_at) ? b : a;
}
export function mergeRows(current: Transaction[], incoming: Transaction[]): Transaction[] {
  const map = new Map(current.map(tx => [tx.id, tx]));
  for (const tx of incoming) map.set(tx.id, map.has(tx.id) ? newer(map.get(tx.id)!, tx) : tx);
  return [...map.values()].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}
export async function fetchAll<T>(path: string, signal?: AbortSignal): Promise<{ items: T[]; final?: string }> {
  const items: T[] = []; let cursor: string | null = null; let final: string | undefined;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await getJson<Page<T>>(`${API_URL}${path}?${query}`, signal);
    items.push(...page.items);
    if (page.sync_token) final = page.sync_token;
    cursor = page.next_cursor;
  } while (cursor);
  return { items, final };
}
type Tombstone = { id: string; deleted: true; updated_at?: string };
function isTombstone(value: unknown): value is Tombstone {
  return !!value && typeof value === 'object' && 'deleted' in value && value.deleted === true && 'id' in value && typeof value.id === 'string';
}
async function fetchChanges(since: string, signal?: AbortSignal) {
  const changes: unknown[] = []; let cursor: string | null = null; let token = since;
  do {
    const query = new URLSearchParams({ since, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await getJson<Page<unknown>>(`${API_URL}/v1/transactions/changes?${query}`, signal);
    changes.push(...page.items); if (page.sync_token) token = page.sync_token; cursor = page.next_cursor;
  } while (cursor);
  return { changes, token };
}
export function applyChanges(state: StoredState, changes: unknown[], token: string, accounts: Account[]): StoredState {
  const latest = new Map<string, { value: Transaction | Tombstone; deleted: boolean; at: number }>();
  for (const value of changes) {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') continue;
    const deleted = isTombstone(value);
    const normalized = deleted ? value : normalizeTransaction(value);
    const at = Date.parse(normalized.updated_at ?? ('occurred_at' in normalized ? normalized.occurred_at : ''));
    if (!Number.isFinite(at)) continue;
    const previous = latest.get(value.id);
    if (!previous || at >= previous.at) latest.set(value.id, { value: normalized, deleted, at });
  }
  const rows = new Map(state.transactions.map(tx => [tx.id, tx]));
  for (const [id, event] of latest) {
    const old = rows.get(id); const oldAt = old ? Date.parse(old.updated_at ?? old.occurred_at) : -Infinity;
    if (event.at < oldAt) continue;
    if (event.deleted) rows.delete(id);
    else rows.set(id, event.value as Transaction);
  }
  return { ...state, accounts, transactions: [...rows.values()].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)), syncToken: token, lastSyncedAt: new Date().toISOString(), hasSynced: true };
}
export async function syncState(state: StoredState, signal?: AbortSignal): Promise<StoredState> {
  let accounts = state.accounts;
  try { accounts = (await getJson<{ items: Account[] }>(`${API_URL}/v1/accounts`, signal)).items; } catch (error) {
    if (!state.hasSynced) throw error;
  }
  let current = state;
  if (!current.syncToken) {
    const full = await fetchAll<unknown>('/v1/transactions', signal);
    current = { ...state, accounts, transactions: mergeRows([], full.items.map(normalizeTransaction)), syncToken: full.final ?? null, lastSyncedAt: new Date().toISOString(), hasSynced: true };
    if (!current.syncToken) return current;
  }
  try {
    const delta = await fetchChanges(current.syncToken!, signal);
    return applyChanges(current, delta.changes, delta.token, accounts);
  } catch (error) {
    // Only an expired cursor requires a snapshot. Temporary network/server errors leave the cached state untouched.
    if (!(error instanceof ApiError) || error.status !== 410) throw error;
    const full = await fetchAll<unknown>('/v1/transactions', signal);
    const snapshot = { ...current, accounts, transactions: mergeRows([], full.items.map(normalizeTransaction)), syncToken: full.final ?? null, lastSyncedAt: new Date().toISOString(), hasSynced: true };
    if (!snapshot.syncToken) return snapshot;
    const delta = await fetchChanges(snapshot.syncToken, signal);
    return applyChanges(snapshot, delta.changes, delta.token, accounts);
  }
}
