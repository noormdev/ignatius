/** Carry the viewer's localStorage state and hash into an exported HTML file. */

import type { ViewState } from '../../generators/app';
import { createLayoutStore, isPlainObject, MAX_ENTRIES, type StorageLike } from '../views/graph/layout-store';
import { FLOW_LAYOUT_STORAGE_KEY, GRAPH_LAYOUT_STORAGE_KEY } from './storage-keys';

const STORAGE_PREFIX = 'ignatius-';
const APPLIED_KEY = 'ignatius-view-state-applied';
const LAYOUT_STORE_KEYS = new Set([GRAPH_LAYOUT_STORAGE_KEY, FLOW_LAYOUT_STORAGE_KEY]);

type ViewStateTarget = {
  __VIEW_STATE__?: ViewState;
  __THEME_MODE__?: 'dark' | 'light';
  __LAYOUT_KEY__?: string;
};

type EnumerableStorage = StorageLike & Pick<Storage, 'key' | 'length'>;

export function collectViewState(): ViewState {
  const storage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !key.startsWith(STORAGE_PREFIX) || key === APPLIED_KEY) continue;
    const value = localStorage.getItem(key);
    if (value !== null) storage[key] = value;
  }
  return { storage, hash: location.hash };
}

// FNV-1a: synchronous, unlike crypto.subtle, which some browsers withhold from file:// pages.
function digestOf(viewState: ViewState): string {
  const keys = Object.keys(viewState.storage).sort();
  const canonical = JSON.stringify([viewState.hash, keys.map(key => [key, viewState.storage[key]])]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

type AppliedRecord = { digest: string; seq: number };

function isAppliedRecord(value: unknown): value is AppliedRecord {
  return typeof value === 'object' && value !== null
    && 'digest' in value && typeof value.digest === 'string'
    && 'seq' in value && typeof value.seq === 'number';
}

function readApplied(storage: StorageLike): Record<string, AppliedRecord> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(APPLIED_KEY) ?? '{}');
    if (!isPlainObject(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, AppliedRecord] => isAppliedRecord(entry[1])));
  } catch {
    return {};
  }
}

// Every export opened from file:// shares one origin, so the map would otherwise grow with each model ever opened.
function recordApplied(applied: Record<string, AppliedRecord>, layoutKey: string, digest: string): Record<string, AppliedRecord> {
  const seq = Math.max(0, ...Object.values(applied).map(record => record.seq)) + 1;
  const newest = Object.entries({ ...applied, [layoutKey]: { digest, seq } })
    .sort(([, a], [, b]) => b.seq - a.seq)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(newest);
}

function isPreferenceKey(key: string): boolean {
  return key.startsWith(STORAGE_PREFIX) && key !== APPLIED_KEY && !LAYOUT_STORE_KEYS.has(key);
}

/** Seed an export's view state once per snapshot and model, so a reload keeps the recipient's own changes. */
export function applyViewState(target: ViewStateTarget, storage: EnumerableStorage, loc: { hash: string }): void {
  const viewState = target.__VIEW_STATE__;
  if (!viewState) return;
  seedOnce(viewState, target.__LAYOUT_KEY__ ?? '', storage, loc);

  // useThemeMode reads __THEME_MODE__ before localStorage, and the export bakes the snapshot's theme into it.
  const theme = storage.getItem('ignatius-theme');
  if (theme === 'dark' || theme === 'light') target.__THEME_MODE__ = theme;
}

function seedOnce(viewState: ViewState, layoutKey: string, storage: EnumerableStorage, loc: { hash: string }): void {
  const digest = digestOf(viewState);
  const applied = readApplied(storage);
  if (applied[layoutKey]?.digest === digest) return;

  const omitted: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && isPreferenceKey(key) && !Object.hasOwn(viewState.storage, key)) omitted.push(key);
  }
  for (const key of omitted) storage.removeItem(key);

  for (const [key, value] of Object.entries(viewState.storage)) {
    if (LAYOUT_STORE_KEYS.has(key)) createLayoutStore(storage, undefined, key).merge(value);
    else storage.setItem(key, value);
  }
  storage.setItem(APPLIED_KEY, JSON.stringify(recordApplied(applied, layoutKey, digest)));
  if (loc.hash === '' && viewState.hash !== '') loc.hash = viewState.hash;
}

export async function downloadExport(): Promise<void> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectViewState()),
  });
  if (!res.ok) throw new Error((await res.text()) || `Export failed (${res.status})`);
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'model.html';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
