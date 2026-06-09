// Verification: hash-router parse + serialize round-trips
import { parseHash, serializeHash } from '../../src/hash-router';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- parse ---

{
  const result = parseHash('');
  assert(deepEqual(result, {}), "parse('') → empty state");
}

{
  const result = parseHash('#entity=Party');
  assert(deepEqual(result, { entity: 'Party' }), "parse('#entity=Party') → { entity: 'Party' }");
}

{
  const result = parseHash('#zoom=1.5&pan=200,100');
  assert(
    deepEqual(result, { zoom: 1.5, pan: { x: 200, y: 100 } }),
    "parse('#zoom=1.5&pan=200,100') → { zoom: 1.5, pan: { x: 200, y: 100 } }"
  );
}

{
  const result = parseHash('#entity=X&zoom=2&pan=10,-5');
  assert(
    deepEqual(result, { entity: 'X', zoom: 2, pan: { x: 10, y: -5 } }),
    "parse('#entity=X&zoom=2&pan=10,-5') → all three set"
  );
}

{
  const result = parseHash('#zoom=abc');
  assert(result.zoom === undefined, "parse('#zoom=abc') → zoom dropped (invalid)");
}

{
  const result = parseHash('#pan=10');
  assert(result.pan === undefined, "parse('#pan=10') → pan dropped (malformed, only one coord)");
}

{
  const result = parseHash('#pan=foo,bar');
  assert(result.pan === undefined, "parse('#pan=foo,bar') → pan dropped (non-numeric)");
}

// --- serialize ---

{
  const result = serializeHash({ entity: 'Party' });
  assert(result === 'entity=Party', "serialize({ entity: 'Party' }) → 'entity=Party'");
}

{
  const result = serializeHash({ zoom: 1.5, pan: { x: 200, y: 100 } });
  assert(result.includes('zoom=1.5'), "serialize zoom+pan contains zoom=1.5");
  assert(result.includes('pan=200,100'), "serialize zoom+pan contains pan=200,100");
}

{
  const result = serializeHash({});
  assert(result === '', "serialize({}) → ''");
}

// --- view field ---

{
  const result = parseHash('#view=graph');
  assert(result.view === 'graph', "parse('#view=graph') → { view: 'graph' }");
}

{
  const result = parseHash('#view=flow');
  assert(result.view === 'flow', "parse('#view=flow') → { view: 'flow' }");
}

{
  const result = parseHash('#view=dict');
  assert(result.view === 'dict', "parse('#view=dict') → { view: 'dict' }");
}

{
  const result = parseHash('#view=bogus');
  assert(result.view === undefined, "parse('#view=bogus') → view dropped (invalid value)");
}

{
  const result = parseHash('#view=graph&entity=Party&zoom=1.5&pan=10,20');
  assert(result.view === 'graph', "parse with view + other params → view set");
  assert(result.entity === 'Party', "parse with view + other params → entity set");
  assert(result.zoom === 1.5, "parse with view + other params → zoom set");
}

{
  const result = serializeHash({ view: 'flow' });
  assert(result === 'view=flow', "serialize({ view: 'flow' }) → 'view=flow'");
}

{
  const result = serializeHash({ view: 'graph', entity: 'Party' });
  assert(result.includes('view=graph'), "serialize with view + entity contains view=graph");
  assert(result.includes('entity=Party'), "serialize with view + entity contains entity=Party");
}

// --- dfd field ---

{
  const result = parseHash('#view=flow&dfd=order-to-cash');
  assert(result.dfd === 'order-to-cash', "parse('#view=flow&dfd=order-to-cash') → { dfd: 'order-to-cash' }");
}

{
  const result = parseHash('#view=flow&dfd=refund');
  assert(result.dfd === 'refund', "parse('#view=flow&dfd=refund') → { dfd: 'refund' }");
}

{
  // Empty dfd value dropped
  const result = parseHash('#view=flow&dfd=');
  assert(result.dfd === undefined, "parse('…&dfd=') → dfd dropped (empty)");
}

{
  // dfd survives when other fields are present
  const result = parseHash('#view=flow&dfd=order-to-cash&zoom=1.5');
  assert(result.dfd === 'order-to-cash', "parse with dfd + other fields → dfd set");
  assert(result.zoom === 1.5, "parse with dfd + other fields → zoom set");
}

{
  const result = serializeHash({ view: 'flow', dfd: 'order-to-cash' });
  assert(result.includes('dfd=order-to-cash'), "serialize with dfd → contains 'dfd=order-to-cash'");
  assert(result.includes('view=flow'), "serialize with dfd → contains 'view=flow'");
}

{
  // dfd with special chars: hyphens are safe
  const result = serializeHash({ dfd: 'order-to-cash' });
  assert(result === 'dfd=order-to-cash', "serialize({ dfd: 'order-to-cash' }) → 'dfd=order-to-cash'");
}

// --- dfd encode/decode symmetry ---

{
  // dfd with spaces (encoded as %20): decodeURIComponent must restore the original
  const encoded = serializeHash({ view: 'flow', dfd: 'Create Sales Order' });
  const parsed = parseHash('#' + encoded);
  assert(parsed.dfd === 'Create Sales Order', "dfd encode/decode: 'Create Sales Order' round-trips exactly");
}

{
  // dfd with hyphens (no encoding needed): still correct
  const encoded = serializeHash({ view: 'flow', dfd: 'order-to-cash' });
  const parsed = parseHash('#' + encoded);
  assert(parsed.dfd === 'order-to-cash', "dfd encode/decode: 'order-to-cash' round-trips exactly");
}

// --- round-trip ---

const states = [
  { entity: 'Party' },
  { zoom: 1.5, pan: { x: 200, y: 100 } },
  { entity: 'X', zoom: 2, pan: { x: 10, y: -5 } },
  { entity: 'Foo_Bar', zoom: 0.75, pan: { x: -50, y: 33.5 } },
  { view: 'graph' as const },
  { view: 'flow' as const, entity: 'Order' },
  { view: 'dict' as const, zoom: 1.0, pan: { x: 0, y: 0 } },
  { view: 'flow' as const, dfd: 'order-to-cash' },
  { view: 'flow' as const, dfd: 'refund' },
];

for (const state of states) {
  const serialized = serializeHash(state);
  const parsed = parseHash('#' + serialized);
  assert(deepEqual(parsed, state), `round-trip: ${JSON.stringify(state)}`);
}

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
