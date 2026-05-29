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

// --- round-trip ---

const states = [
  { entity: 'Party' },
  { zoom: 1.5, pan: { x: 200, y: 100 } },
  { entity: 'X', zoom: 2, pan: { x: 10, y: -5 } },
  { entity: 'Foo_Bar', zoom: 0.75, pan: { x: -50, y: 33.5 } },
];

for (const state of states) {
  const serialized = serializeHash(state);
  const parsed = parseHash('#' + serialized);
  assert(deepEqual(parsed, state), `round-trip: ${JSON.stringify(state)}`);
}

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
