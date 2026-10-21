/**
 * layout-store.ts — localStorage helper for persisting graph node positions.
 *
 * Uses a single key (`ignatius-layout-positions`) holding a JSON map:
 *   { [layoutKey: string]: { positions: { [nodeId: string]: { x: number; y: number } }, savedAt: number, hidden?: string[] } }
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
  /** Node ids the user removed from view; absent on entries saved before hiding existed. */
  hidden?: string[];
}

type LayoutStore = Record<string, LayoutEntry>;

export interface LayoutStoreHandle {
  load(layoutKey: string): PositionMap | null;
  hidden(layoutKey: string): string[];
  save(layoutKey: string, positions: PositionMap, hidden?: string[]): void;
  clear(layoutKey: string): void;
  /** True when any arrangement is saved, for any model. */
  hasEntries(): boolean;
  /** Newest saved position of `nodeId` outside `exceptKey`, from an entry that also saved one of
   *  `neighbourIds`; the store is shared by every model, so this keeps out same-named nodes. */
  lastPosition(nodeId: string, exceptKey: string, neighbourIds: string[]): { x: number; y: number } | null;
  /** The same model before its last edit: the newest entry outside `exceptKey` whose shared ids are
   *  at least half of `nodeIds` and half of its own entities. Null for an empty key. */
  previous(exceptKey: string, nodeIds: string[]): { positions: PositionMap; hidden: string[] } | null;
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

    hidden(layoutKey: string): string[] {
      if (!layoutKey) return [];
      return readStore(storage, storageKey)[layoutKey]?.hidden ?? [];
    },

    save(layoutKey: string, positions: PositionMap, hidden: string[] = []): void {
      if (!layoutKey) return;
      const store = readStore(storage, storageKey);
      store[layoutKey] = hidden.length > 0
        ? { positions, savedAt: clock(), hidden }
        : { positions, savedAt: clock() };
      writeStore(storage, pruneToNewest(store), storageKey);
    },

    clear(layoutKey: string): void {
      if (!layoutKey) return;
      const store = readStore(storage, storageKey);
      delete store[layoutKey];
      writeStore(storage, store, storageKey);
    },

    hasEntries(): boolean {
      return Object.keys(readStore(storage, storageKey)).length > 0;
    },

    lastPosition(nodeId: string, exceptKey: string, neighbourIds: string[]): { x: number; y: number } | null {
      const entries = Object.entries(readStore(storage, storageKey))
        .filter(([key, entry]) => key !== exceptKey
          && entry?.positions?.[nodeId] !== undefined
          && neighbourIds.some(id => entry.positions[id] !== undefined))
        .sort(([, a], [, b]) => b.savedAt - a.savedAt);
      return entries[0]?.[1].positions[nodeId] ?? null;
    },

    previous(exceptKey: string, nodeIds: string[]): { positions: PositionMap; hidden: string[] } | null {
      // An empty key can never save, so borrowing for it would strand the result.
      if (!exceptKey || nodeIds.length === 0) return null;
      const candidates = Object.entries(readStore(storage, storageKey))
        .filter(([key, entry]) => key !== exceptKey && entry?.positions)
        .map(([, entry]) => {
          const shared = nodeIds.filter(id => entry.positions[id] !== undefined).length;
          // Joiner diamonds are saved too; their ids start with `_`.
          const saved = Object.keys(entry.positions).filter(id => !id.startsWith('_')).length;
          return { entry, shared, saved };
        })
        // Half of each side, so a larger model holding these names does not qualify.
        .filter(({ shared, saved }) => shared * 2 >= nodeIds.length && shared * 2 >= saved)
        .sort((a, b) => b.entry.savedAt - a.entry.savedAt);
      const entry = candidates[0]?.entry;
      return entry ? { positions: entry.positions, hidden: entry.hidden ?? [] } : null;
    },
  };
}
