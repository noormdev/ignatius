/**
 * test-parse-predicate.ts — verifies bidirectional predicate normalization.
 *
 * Three assertions via parseModels against a tiny tmp fixture:
 *   1. Object form { fwd, rev } → preserved exactly on edge.predicate.
 *   2. String form → fwd === rev === string.
 *   3. Object missing fwd → fwd === '', rev preserved.
 *
 * Also unit-asserts normalizePredicate directly (exported from parse.ts).
 *
 * Fixture written to tmp/test-parse-predicate/ and left in place (tmp/ is gitignored).
 */

import { parseModels, normalizePredicate } from '../../src/model/parse';
import { rmSync, mkdirSync, existsSync } from 'node:fs';

const TMP = 'tmp/test-parse-predicate';

// Hard assert: a failure must abort the script with a non-zero exit so the
// `bun run test` loop (and CI) actually gates on it. console.assert does NOT
// exit non-zero in Bun, so it cannot be used here.
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Unit assertions on normalizePredicate (fast, no I/O)
// ---------------------------------------------------------------------------

{
  const r = normalizePredicate('holds');
  assert(r.fwd === 'holds', `FAIL: string form fwd — got "${r.fwd}"`);
  assert(r.rev === 'holds', `FAIL: string form rev — got "${r.rev}"`);
  console.log('PASS: normalizePredicate string form → fwd===rev===string');
}

{
  const r = normalizePredicate({ fwd: 'places', rev: 'is placed by' });
  assert(r.fwd === 'places', `FAIL: object form fwd — got "${r.fwd}"`);
  assert(r.rev === 'is placed by', `FAIL: object form rev — got "${r.rev}"`);
  console.log('PASS: normalizePredicate object form { fwd, rev } → preserved exactly');
}

{
  const r = normalizePredicate({ rev: 'is held by' });
  assert(r.fwd === '', `FAIL: missing fwd — got "${r.fwd}"`);
  assert(r.rev === 'is held by', `FAIL: missing fwd rev — got "${r.rev}"`);
  console.log('PASS: normalizePredicate object missing fwd → fwd=""');
}

{
  const r = normalizePredicate(null);
  assert(r.fwd === '', `FAIL: null fwd — got "${r.fwd}"`);
  assert(r.rev === '', `FAIL: null rev — got "${r.rev}"`);
  console.log('PASS: normalizePredicate null → { fwd: "", rev: "" }');
}

{
  const r = normalizePredicate(undefined);
  assert(r.fwd === '', `FAIL: undefined fwd — got "${r.fwd}"`);
  assert(r.rev === '', `FAIL: undefined rev — got "${r.rev}"`);
  console.log('PASS: normalizePredicate undefined → { fwd: "", rev: "" }');
}

// ---------------------------------------------------------------------------
// Integration assertions via parseModels against a tiny tmp fixture
// ---------------------------------------------------------------------------

// Build fixture dir
if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(`${TMP}/_groups`, { recursive: true });

// ignatius.yml — minimal
await Bun.write(`${TMP}/ignatius.yml`, 'name: test-parse-predicate\n');

// Parent entity: Party
await Bun.write(`${TMP}/party.md`, `---
entity: Party
pk:
  - party_id
columns:
  party_id:
    type: uuid
---
`);

// Child entity: Order — three relationships to Party with different predicate forms
await Bun.write(`${TMP}/order.md`, `---
entity: Order
pk:
  - order_id
columns:
  order_id:
    type: uuid
  party_id_fwd_rev:
    type: uuid
  party_id_str:
    type: uuid
  party_id_no_fwd:
    type: uuid
relationships:
  - target: Party
    on:
      party_id_fwd_rev: party_id
    predicate:
      fwd: places
      rev: is placed by
  - target: Party
    on:
      party_id_str: party_id
    predicate: belongs to
  - target: Party
    on:
      party_id_no_fwd: party_id
    predicate:
      rev: is held by
---
`);

const { model } = await parseModels(TMP);

// Three edges should exist (one per relationship)
assert(model.edges.length === 3, `FAIL: expected 3 edges, got ${model.edges.length}`);

const edgeFwdRev = model.edges.find(e => e.predicate.fwd === 'places');
const edgeStr = model.edges.find(e => e.predicate.fwd === 'belongs to');
const edgeNoFwd = model.edges.find(e => e.predicate.rev === 'is held by');

// 1. Object form { fwd, rev } → preserved
assert(edgeFwdRev !== undefined, 'FAIL: object form edge not found');
assert(edgeFwdRev.predicate.fwd === 'places', `FAIL: object fwd — got "${edgeFwdRev.predicate.fwd}"`);
assert(edgeFwdRev.predicate.rev === 'is placed by', `FAIL: object rev — got "${edgeFwdRev.predicate.rev}"`);
console.log('PASS: parseModels object predicate { fwd, rev } → preserved on edge');

// 2. String form → fwd === rev === string
assert(edgeStr !== undefined, 'FAIL: string form edge not found');
assert(edgeStr.predicate.fwd === 'belongs to', `FAIL: str fwd — got "${edgeStr.predicate.fwd}"`);
assert(edgeStr.predicate.rev === 'belongs to', `FAIL: str rev — got "${edgeStr.predicate.rev}"`);
console.log('PASS: parseModels string predicate → fwd===rev===string on edge');

// 3. Object missing fwd → fwd === '', rev preserved
assert(edgeNoFwd !== undefined, 'FAIL: no-fwd edge not found');
assert(edgeNoFwd.predicate.fwd === '', `FAIL: no-fwd fwd — got "${edgeNoFwd.predicate.fwd}"`);
assert(edgeNoFwd.predicate.rev === 'is held by', `FAIL: no-fwd rev — got "${edgeNoFwd.predicate.rev}"`);
console.log('PASS: parseModels object predicate missing fwd → fwd="" on edge');

console.log('\nAll parse-predicate tests passed.');
