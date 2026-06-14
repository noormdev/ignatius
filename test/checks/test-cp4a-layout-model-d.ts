/**
 * test-cp4a-layout-model-d.ts — assertion check for CP-4a: layout model D node set.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies:
 *  C14 (role-split ≤2) — on the proving model's L1 overview (__system__), each
 *       external appears as at most TWO layout nodes: one --src (band 0) and/or
 *       one --snk (band 4). No per-partner copies (ext:<id>--src--<proc>).
 *       "LLM-Agent" (the single external in llm-memory-db-mssql) yields ≤2 total.
 *
 *  C13 (length gate) — isInlineLabel('order_id') is true;
 *       isInlineLabel of a long payload is false; boundary at SHORT_LABEL_MAX.
 *       buildElkGraph reserves a label dummy only for short labels:
 *       - a known long-label edge in memory-lifecycle is absent from labelPositions
 *       - a known short-label edge (if present) IS present
 *       (all non-db labels in memory-lifecycle are > 22 chars; the check verifies
 *       the labelPositions record is empty for non-db, non-short edges.)
 */

import { createRequire } from 'node:module';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';
import { buildFlowData } from '../../src/flow-view/flow-layout';
import {
  computeElkLayout,
  isInlineLabel,
  SHORT_LABEL_MAX,
  isDbEdge,
  type ElkLayoutResult,
} from '../../src/flow-view/elk-flow-layout';

const MODEL_DIR = 'models/llm-memory-db-mssql';

// Supply a Bun-compatible ELK workerFactory (see test-elk-flow-positions.ts).
const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const workerFactory = () => new Worker(workerPath);

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

/** Walk the leveled tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagramInTree(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const { flowModel } = await parseFlows(MODEL_DIR);

// ── C13: isInlineLabel helper ────────────────────────────────────────────────

console.log('\n=== C13: isInlineLabel helper ===');

assert(SHORT_LABEL_MAX === 22, `SHORT_LABEL_MAX should be 22, got ${SHORT_LABEL_MAX}`);
console.log(`PASS: SHORT_LABEL_MAX = ${SHORT_LABEL_MAX}`);

assert(isInlineLabel('order_id'), `isInlineLabel('order_id') should be true (len=${('order_id').length})`);
console.log(`PASS: isInlineLabel('order_id') = true`);

assert(!isInlineLabel(undefined), `isInlineLabel(undefined) should be false`);
console.log(`PASS: isInlineLabel(undefined) = false`);

assert(!isInlineLabel(''), `isInlineLabel('') should be false`);
console.log(`PASS: isInlineLabel('') = false`);

// Exactly at the boundary: 22-char string should be inline
const atBoundary = 'a'.repeat(SHORT_LABEL_MAX);
assert(isInlineLabel(atBoundary), `isInlineLabel of ${SHORT_LABEL_MAX}-char string should be true`);
console.log(`PASS: isInlineLabel of ${SHORT_LABEL_MAX}-char string = true`);

// One over boundary: 23-char string should NOT be inline
const overBoundary = 'a'.repeat(SHORT_LABEL_MAX + 1);
assert(!isInlineLabel(overBoundary), `isInlineLabel of ${SHORT_LABEL_MAX + 1}-char string should be false`);
console.log(`PASS: isInlineLabel of ${SHORT_LABEL_MAX + 1}-char string = false`);

// Long payload: the first non-db ext label in memory-lifecycle is 42 chars
const longLabel = 'attachment request (memory_id, project_id)';
assert(longLabel.length > SHORT_LABEL_MAX, `test label is not actually long (${longLabel.length})`);
assert(!isInlineLabel(longLabel), `isInlineLabel('${longLabel}') should be false`);
console.log(`PASS: isInlineLabel long payload (len=${longLabel.length}) = false`);

// ── C13: ELK label-dummy reservation ────────────────────────────────────────

console.log('\n=== C13: ELK label-dummy reservation in memory-lifecycle ===');

const memLifeDiagram = findDiagramInTree(flowModel.diagrams, 'memory-lifecycle');
if (!memLifeDiagram) {
  console.error('FAIL: memory-lifecycle diagram not found');
  process.exit(1);
}

const { edges: memEdges } = buildFlowData(memLifeDiagram);
const result: ElkLayoutResult = await computeElkLayout(memLifeDiagram, { workerFactory });

// The production gate is `isInlineLabel` (length), NOT `isDbEdge`. We use
// `isDbEdge` here ONLY to scope the subset: in memory-lifecycle every non-db
// labeled edge has a label > 22 chars (verified: shortest is "newly assigned
// memory_id" = 24 chars), so those are a clean set of expected-suppressed edges.
const nonDbLabeledEdges = memEdges.filter(e => !isDbEdge(e.source, e.target) && e.label);
console.log(`  Non-db labeled edges: ${nonDbLabeledEdges.length}`);

for (const edge of nonDbLabeledEdges) {
  assert(
    !isInlineLabel(edge.label),
    `Edge ${edge.id} label "${edge.label.slice(0, 40)}" (len=${edge.label.length}) is ≤22 chars — test assumption wrong`,
  );
  const hasLabelPos = result.labelPositions[edge.id] !== undefined;
  assert(
    !hasLabelPos,
    `Long-label edge ${edge.id} ("${edge.label.slice(0, 40)}", len=${edge.label.length}) has a label position — should be absent`,
  );
  console.log(
    `  PASS: long-label edge ${edge.id} (len=${edge.label.length}) absent from labelPositions`,
  );
}

// Sanity: we tested at least one long-label edge
assert(
  nonDbLabeledEdges.length > 0,
  'No non-db labeled edges found in memory-lifecycle — test is vacuous',
);

console.log('PASS C13: all long-label non-db edges are absent from labelPositions');

// The length gate governs db: edges too — a long db: column-list label must
// likewise be absent from labelPositions (this used to be the db-only rule;
// now it falls out of the same length gate). Assert it explicitly so the gate
// is proven to apply regardless of endpoint kind.
const dbLongLabeledEdges = memEdges.filter(e => isDbEdge(e.source, e.target) && e.label && !isInlineLabel(e.label));
assert(
  dbLongLabeledEdges.length > 0,
  'No long-label db: edges found in memory-lifecycle — db length-gate path is vacuous',
);
for (const edge of dbLongLabeledEdges) {
  assert(
    result.labelPositions[edge.id] === undefined,
    `Long-label db: edge ${edge.id} (len=${edge.label.length}) has a label position — length gate must suppress it`,
  );
}
console.log(`PASS C13: ${dbLongLabeledEdges.length} long-label db: edges also absent from labelPositions (length gate, not kind)`);

// ── C14: external role-split ≤2 on L1 overview ──────────────────────────────

console.log('\n=== C14: external role-split on __system__ (L1 overview) ===');

const l1Diagram = findDiagramInTree(flowModel.diagrams, '__system__');
if (!l1Diagram) {
  console.error('FAIL: __system__ (L1 overview) diagram not found');
  process.exit(1);
}

const { nodes: l1Nodes } = buildFlowData(l1Diagram);
const extNodes = l1Nodes.filter(n => n.nodeType === 'external');

console.log(`  External layout nodes found: ${extNodes.length}`);
console.log(`  IDs: ${extNodes.map(n => n.id).join(', ')}`);

// No per-partner copies: none of the ids may contain the old --src--<proc> pattern.
const perPartnerIds = extNodes.filter(n => {
  // Per-partner pattern: ext:<id>--src--<proc> or ext:<id>--snk--<proc>
  // Detect by checking if there are more than 2 '--' segments
  const afterExt = n.id.slice('ext:'.length);
  const parts = afterExt.split('--');
  return parts.length > 2;
});

assert(
  perPartnerIds.length === 0,
  `Found per-partner external copies (should be 0): ${perPartnerIds.map(n => n.id).join(', ')}`,
);
console.log('PASS: no per-partner external copies (no ext:<id>--src--<proc> pattern)');

// Group by external base id: each external gets at most one --src and one --snk
const extById = new Map<string, { srcCount: number; snkCount: number }>();
for (const n of extNodes) {
  // id is ext:<extId>--src or ext:<extId>--snk (after the fix)
  const withoutPrefix = n.id.slice('ext:'.length); // e.g. "LLM-Agent--src"
  const dashIdx = withoutPrefix.lastIndexOf('--');
  const extId = dashIdx >= 0 ? withoutPrefix.slice(0, dashIdx) : withoutPrefix;
  const role = dashIdx >= 0 ? withoutPrefix.slice(dashIdx + 2) : '';

  let entry = extById.get(extId);
  if (!entry) { entry = { srcCount: 0, snkCount: 0 }; extById.set(extId, entry); }
  if (role === 'src') entry.srcCount++;
  if (role === 'snk') entry.snkCount++;
}

for (const [extId, counts] of extById) {
  assert(
    counts.srcCount <= 1,
    `External "${extId}" has ${counts.srcCount} --src copies (max 1)`,
  );
  assert(
    counts.snkCount <= 1,
    `External "${extId}" has ${counts.snkCount} --snk copies (max 1)`,
  );
  const total = counts.srcCount + counts.snkCount;
  assert(
    total <= 2,
    `External "${extId}" has ${total} total copies (max 2)`,
  );
  console.log(
    `PASS: external "${extId}": ${counts.srcCount} --src, ${counts.snkCount} --snk = ${total} total`,
  );
}

// Specific check: LLM-Agent appears at most twice
const llmEntry = extById.get('LLM-Agent');
if (llmEntry) {
  const total = llmEntry.srcCount + llmEntry.snkCount;
  assert(total <= 2, `LLM-Agent has ${total} copies (max 2)`);
  console.log(`PASS C14: LLM-Agent appears ${total} time(s) (≤2)`);
}

console.log('\nAll CP-4a assertions passed.');
process.exit(0);
