/**
 * test-layout-store.ts — unit tests for src/layout-store.ts.
 *
 * Uses an in-memory Map-backed StorageLike stub so no real localStorage is
 * needed. The store module is injected with it via createLayoutStore(storage).
 *
 * Coverage:
 *   1. Round-trip: save then load returns exact positions.
 *   2. Unknown key returns null.
 *   3. Corrupt JSON in storage returns null (no throw).
 *   4. Pruning keeps only the newest 10 entries when 11+ are inserted.
 *   5. Clear removes one key's entry without touching others.
 */

import { createLayoutStore } from '../../src/layout-store';
import type { StorageLike, PositionMap } from '../../src/layout-store';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// In-memory StorageLike stub
// ---------------------------------------------------------------------------

function makeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

// ---------------------------------------------------------------------------
// 1. Round-trip: save then load returns exact positions
// ---------------------------------------------------------------------------

{
  const store = createLayoutStore(makeStorage());
  const positions: PositionMap = {
    Party: { x: 100, y: 200 },
    Order: { x: 300, y: 150 },
  };
  store.save('key-abc', positions);
  const loaded = store.load('key-abc');
  assert(loaded !== null, 'FAIL: round-trip — load returned null after save');
  assert(loaded['Party']?.x === 100, `FAIL: round-trip Party.x — got ${loaded['Party']?.x}`);
  assert(loaded['Party']?.y === 200, `FAIL: round-trip Party.y — got ${loaded['Party']?.y}`);
  assert(loaded['Order']?.x === 300, `FAIL: round-trip Order.x — got ${loaded['Order']?.x}`);
  assert(loaded['Order']?.y === 150, `FAIL: round-trip Order.y — got ${loaded['Order']?.y}`);
  console.log('PASS: save then load returns exact positions');
}

// ---------------------------------------------------------------------------
// 2. Unknown key returns null
// ---------------------------------------------------------------------------

{
  const store = createLayoutStore(makeStorage());
  const result = store.load('nonexistent-key');
  assert(result === null, `FAIL: unknown key — expected null, got ${JSON.stringify(result)}`);
  console.log('PASS: load for unknown key returns null');
}

// ---------------------------------------------------------------------------
// 3. Corrupt JSON in storage returns null (no throw)
// ---------------------------------------------------------------------------

{
  const storage = makeStorage();
  // Manually corrupt the storage key before creating the store handle.
  storage.setItem('ignatius-layout-positions', 'not-valid-json{{{');
  const store = createLayoutStore(storage);
  let threw = false;
  let result: PositionMap | null = null;
  try {
    result = store.load('any-key');
  } catch {
    threw = true;
  }
  assert(!threw, 'FAIL: corrupt JSON caused a throw — should return null gracefully');
  assert(result === null, `FAIL: corrupt JSON — expected null, got ${JSON.stringify(result)}`);
  console.log('PASS: corrupt JSON in storage returns null without throw');
}

// ---------------------------------------------------------------------------
// 4. Pruning keeps only newest 10 entries when 11+ are inserted,
//    and the OLDEST entry (smallest savedAt) is the one evicted.
//    Uses an injected counter clock so savedAt values are strictly
//    monotonic even inside a synchronous loop.
// ---------------------------------------------------------------------------

{
  let tick = 0;
  const clockFn = () => ++tick; // returns 1, 2, 3, … — strictly increasing

  const storage = makeStorage();
  const store = createLayoutStore(storage, clockFn);

  // Insert 11 entries. With the counter clock, key-000 gets savedAt=1 (oldest)
  // and key-010 gets savedAt=11 (newest). After the 11th insert the store
  // prunes to the 10 newest, evicting key-000.
  const keys: string[] = [];
  for (let i = 0; i < 11; i++) {
    const key = `key-${String(i).padStart(3, '0')}`;
    keys.push(key);
    store.save(key, { NodeA: { x: i, y: i } });
  }

  let surviving = 0;
  for (const k of keys) {
    if (store.load(k) !== null) surviving++;
  }
  assert(surviving === 10, `FAIL: pruning — expected 10 surviving entries, got ${surviving}`);

  // The oldest entry must be evicted — NOT merely "some" entry.
  assert(
    store.load('key-000') === null,
    'FAIL: pruning — key-000 (oldest, savedAt=1) should have been evicted',
  );

  // The newest 10 must all survive.
  for (let i = 1; i <= 10; i++) {
    const k = `key-${String(i).padStart(3, '0')}`;
    assert(store.load(k) !== null, `FAIL: pruning — ${k} (newer entry) should survive`);
  }

  console.log('PASS: pruning evicts the oldest entry and keeps the newest 10');
}

// ---------------------------------------------------------------------------
// 5. Clear removes one key without touching others
// ---------------------------------------------------------------------------

{
  const store = createLayoutStore(makeStorage());
  const posA: PositionMap = { A: { x: 1, y: 2 } };
  const posB: PositionMap = { B: { x: 3, y: 4 } };
  store.save('key-alpha', posA);
  store.save('key-beta', posB);

  store.clear('key-alpha');

  const afterAlpha = store.load('key-alpha');
  const afterBeta = store.load('key-beta');

  assert(afterAlpha === null, `FAIL: clear — key-alpha should be null, got ${JSON.stringify(afterAlpha)}`);
  assert(afterBeta !== null, 'FAIL: clear — key-beta was removed but should survive');
  assert(afterBeta['B']?.x === 3, `FAIL: clear — key-beta.B.x should be 3, got ${afterBeta['B']?.x}`);
  console.log('PASS: clear removes only the specified key, leaves others intact');
}

console.log('\nAll layout-store tests passed.');
