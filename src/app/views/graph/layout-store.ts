/**
 * layout-store.ts — localStorage helper for persisting graph node positions.
 *
 * Uses a single key (`ignatius-layout-positions`) holding a JSON map:
 *   { [layoutKey: string]: { positions: { [nodeId: string]: { x: number; y: number } }, savedAt: number } }
 *
 * Dependency-injectable via the StorageLike interface so unit tests can run
 * without a real browser localStorage.
 */

const DEFAULT_STORAGE_KEY = 'ignatius-layout-positions';
const MAX_ENTRIES = 10;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PositionMap = Record<string, { x: number; y: number }>;

interface LayoutEntry {
  positions: PositionMap;
  savedAt: number;
}

type LayoutStore = Record<string, LayoutEntry>;

export interface LayoutStoreHandle {
  load(layoutKey: string): PositionMap | null;
  save(layoutKey: string, positions: PositionMap): void;
  clear(layoutKey: string): void;
}

function readStore(storage: StorageLike, storageKey: string): LayoutStore {
  const raw = storage.getItem(storageKey);
  if (!raw) return {};
  // Only this JSON.parse is guarded — it reads untrusted stored data.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LayoutStore;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStore(storage: StorageLike, store: LayoutStore, storageKey: string): void {
  storage.setItem(storageKey, JSON.stringify(store));
}

function pruneToNewest(store: LayoutStore): LayoutStore {
  const keys = Object.keys(store);
  if (keys.length <= MAX_ENTRIES) return store;

  // Sort ascending by savedAt — oldest first — then drop the front.
  const sorted = keys.sort((a, b) => (store[a]?.savedAt ?? 0) - (store[b]?.savedAt ?? 0));
  const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES);
  const pruned = { ...store };
  for (const k of toRemove) delete pruned[k];
  return pruned;
}

/**
 * Creates a layout store handle that reads/writes a JSON map under `storageKey`
 * in `storage`.
 *
 * storageKey defaults to 'ignatius-layout-positions' (the ERD bucket) so all
 * existing ERD callers — which omit the third argument — are byte-for-byte
 * unchanged. The flow path passes a distinct key ('ignatius-flow-layout-positions')
 * so the two surfaces never share a bucket.
 *
 * WHY a third parameter (not a new function): the DI shape is identical; the
 * only variable is the key. Defaulting preserves backward compatibility without
 * duplicating the implementation.
 */
export function createLayoutStore(
  storage: StorageLike = globalThis.localStorage,
  now: (() => number) | undefined = undefined,
  storageKey: string = DEFAULT_STORAGE_KEY,
): LayoutStoreHandle {
  const clock = now ?? (() => Date.now());
  return {
    load(layoutKey: string): PositionMap | null {
      if (!layoutKey) return null;
      const store = readStore(storage, storageKey);
      const entry = store[layoutKey];
      if (!entry) return null;
      return entry.positions;
    },

    save(layoutKey: string, positions: PositionMap): void {
      if (!layoutKey) return;
      const store = readStore(storage, storageKey);
      store[layoutKey] = { positions, savedAt: clock() };
      writeStore(storage, pruneToNewest(store), storageKey);
    },

    clear(layoutKey: string): void {
      if (!layoutKey) return;
      const store = readStore(storage, storageKey);
      delete store[layoutKey];
      writeStore(storage, store, storageKey);
    },
  };
}
