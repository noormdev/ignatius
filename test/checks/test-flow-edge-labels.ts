/**
 * test-flow-edge-labels.ts — CP1 dfd-store-clusters assertions.
 *
 * Covers:
 *  1. label: parses on a db: input entry, independent of data:
 *  2. label: parses on an ext: output entry
 *  3. an entry with no label: parses with label undefined
 *  4. buildFlowData's chip text resolves to the label when present, else the
 *     column-preview join (unchanged behavior), for both db: and ext:
 *  5. adding a label: to an entry does not change layoutFlowFingerprint
 *  6. resolveChipLines never truncates or hides an authored label, regardless
 *     of length — only the column-preview fallback is gated
 *  7. resolveChipLines breaks a multi-item authored label into one full line
 *     per ", "-separated item
 *  8. resolveIoRowCells shows a labelled entry's label in place of its column
 *     list, and leaves an unlabelled entry's column rows unaffected
 *  9. normalizeEdgeData splits a non-array data string on ", " only at paren
 *     depth zero, so a prose item's own parenthesized list stays one line
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert } from '../assert';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildFlowData, resolveChipLines, normalizeEdgeData } from '../../src/flow-view/flow-layout';
import { layoutFlowFingerprint } from '../../src/flows/flow-fingerprint';
import { resolveIoRowCells } from '../../src/app/components/process/IoTable';
import type { FlowDiagram, FlowEndpoint, FlowEdge } from '../../src/flows/flow-parse';

// ---------------------------------------------------------------------------
// Fixture: a tiny flows/ model with a labelled db: input and a labelled
// ext: output, plus an unlabelled db: output for the no-label case.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'ignatius-flow-labels-'));

mkdirSync(join(root, 'flows', 'checkout'), { recursive: true });
mkdirSync(join(root, 'externals'), { recursive: true });

writeFileSync(
  join(root, 'externals', 'Shopper.md'),
  '---\nexternal: Shopper\n---\n',
);

writeFileSync(
  join(root, 'flows', 'checkout', 'Place-Order.md'),
  [
    '---',
    'process: Place Order',
    'inputs:',
    '  - from: db:Order',
    '    data: [id, status]',
    '    label: order lookup',
    'outputs:',
    '  - to: ext:Shopper',
    '    data: confirmation email',
    '    label: order confirmed',
    '  - to: db:OrderLog',
    '    data: [id, status]',
    '---',
    'Body.',
    '',
  ].join('\n'),
);

const { flowModel, globalErrors } = await parseFlows(root);
assert(globalErrors.length === 0, `FAIL: unexpected globalErrors: ${JSON.stringify(globalErrors)}`);

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const diagram = findDiagram(flowModel.diagrams, 'checkout');
assert(diagram !== undefined, 'FAIL: checkout diagram not found');
const process = diagram!.processes.find(p => p.id === 'Place-Order');
assert(process !== undefined, 'FAIL: Place-Order process not found');

rmSync(root, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 1. label: parses on a db: input, independent of data:
// ---------------------------------------------------------------------------

const orderInput = process!.inputs.find(e => e.from.kind === 'db' && e.from.name === 'Order');
assert(orderInput !== undefined, 'FAIL: db:Order input edge not found');
assert(orderInput!.label === 'order lookup', `FAIL: expected label 'order lookup', got '${orderInput!.label}'`);
assert(
  Array.isArray(orderInput!.data) && orderInput!.data.join(',') === 'id,status',
  `FAIL: data: contract should be unaffected by label:, got ${JSON.stringify(orderInput!.data)}`,
);
console.log('PASS: label: parses on a db: input, independent of data:');

// ---------------------------------------------------------------------------
// 2. label: parses on an ext: output
// ---------------------------------------------------------------------------

const shopperOutput = process!.outputs.find(e => e.to.kind === 'ext' && e.to.name === 'Shopper');
assert(shopperOutput !== undefined, 'FAIL: ext:Shopper output edge not found');
assert(shopperOutput!.label === 'order confirmed', `FAIL: expected label 'order confirmed', got '${shopperOutput!.label}'`);
console.log('PASS: label: parses on an ext: output');

// ---------------------------------------------------------------------------
// 3. Absent label: leaves the edge unaffected — label stays undefined
// ---------------------------------------------------------------------------

const logOutput = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'OrderLog');
assert(logOutput !== undefined, 'FAIL: db:OrderLog output edge not found');
assert(logOutput!.label === undefined, `FAIL: expected no label on db:OrderLog, got '${logOutput!.label}'`);
console.log('PASS: an entry with no label: leaves the edge as before');

// ---------------------------------------------------------------------------
// 4. Chip text resolution: buildFlowData picks label over the column preview
// ---------------------------------------------------------------------------

const rendered = buildFlowData(diagram!);
const orderEdgeId = diagram!.edges.findIndex(e => e.from.kind === 'db' && e.from.name === 'Order');
const orderChip = rendered.edges.find(e => e.id === `flow-edge-${orderEdgeId}`);
assert(orderChip !== undefined, 'FAIL: rendered chip for db:Order input not found');
assert(orderChip!.label === 'order lookup', `FAIL: chip label should resolve to 'order lookup', got '${orderChip!.label}'`);

const logEdgeId = diagram!.edges.findIndex(e => e.to.kind === 'db' && e.to.name === 'OrderLog');
const logChip = rendered.edges.find(e => e.id === `flow-edge-${logEdgeId}`);
assert(logChip !== undefined, 'FAIL: rendered chip for db:OrderLog output not found');
assert(logChip!.label === 'id, status', `FAIL: unlabelled edge should keep the column-preview chip, got '${logChip!.label}'`);

const shopperEdgeId = diagram!.edges.findIndex(e => e.to.kind === 'ext' && e.to.name === 'Shopper');
const shopperChip = rendered.edges.find(e => e.id === `flow-edge-${shopperEdgeId}`);
assert(shopperChip !== undefined, 'FAIL: rendered chip for ext:Shopper output not found');
assert(shopperChip!.label === 'order confirmed', `FAIL: ext: edge chip should resolve to 'order confirmed', got '${shopperChip!.label}'`);
console.log('PASS: chip text resolves to label when present (db: and ext:), else the column preview');

// ---------------------------------------------------------------------------
// 5. Fingerprint invariance: adding a label: to an entry does not change
//    layoutFlowFingerprint
// ---------------------------------------------------------------------------

function makeEndpoint(kind: FlowEndpoint['kind'], name: string): FlowEndpoint {
  return { kind, name, raw: `${kind}:${name}` };
}

function makeDiagram(edge: FlowEdge): FlowDiagram {
  return {
    id: 'fp-check',
    title: 'Fingerprint Check',
    processes: [{
      id: 'PlaceOrder',
      label: 'Place Order',
      dottedNumber: '1',
      inputs: [],
      outputs: [edge],
      body: '',
      bodyHtml: '',
      hasSubDfd: false,
      flowId: 'fp-check',
    }],
    externals: [],
    storeRefs: [{ kind: 'db', name: 'Order', displayName: 'Order', flowId: 'fp-check' }],
    edges: [edge],
    subDfds: [],
  };
}

const unlabelled: FlowEdge = {
  from: makeEndpoint('proc', 'PlaceOrder'),
  to: makeEndpoint('db', 'Order'),
  data: ['id', 'status'],
  flowId: 'fp-check',
};
const labelled: FlowEdge = { ...unlabelled, label: 'order placed' };

const k1 = layoutFlowFingerprint(makeDiagram(unlabelled));
const k2 = layoutFlowFingerprint(makeDiagram(labelled));
assert(k1 === k2, `FAIL: adding a label: should not change layoutFlowFingerprint: ${k1} vs ${k2}`);
console.log('PASS: adding a label: to an entry does not change layoutFlowFingerprint');

// ---------------------------------------------------------------------------
// 6. resolveChipLines: an authored label longer than CHIP_TRUNCATE_MAX (22
//    chars) is neither truncated nor hidden — only the column-preview
//    fallback is subject to the chip length gate.
// ---------------------------------------------------------------------------

const longLabel = 'A label well past twenty-two characters long';
assert(longLabel.length > 22, 'FAIL: test fixture longLabel must exceed 22 chars');

const previewGated = resolveChipLines(longLabel, false);
assert(previewGated.hasHiddenLabel, 'FAIL: a long column-preview should still be gated (hidden)');
assert(
  previewGated.lines.length === 1 && previewGated.lines[0]!.endsWith('…') && previewGated.lines[0]!.length < longLabel.length,
  `FAIL: a long column-preview should truncate to a single '…'-suffixed chip, got ${JSON.stringify(previewGated.lines)}`,
);

const authoredUngated = resolveChipLines(longLabel, true);
assert(!authoredUngated.hasHiddenLabel, 'FAIL: an authored label must never be marked hidden, regardless of length');
assert(
  authoredUngated.lines.length === 1 && authoredUngated.lines[0] === longLabel,
  `FAIL: an authored label must render in full, got ${JSON.stringify(authoredUngated.lines)}`,
);
console.log('PASS: an authored label longer than the chip gate is neither truncated nor hidden');

// ---------------------------------------------------------------------------
// 7. resolveChipLines: a two-item authored label (", "-separated) breaks
//    into one line per item, in full — the hand-drawn-DFD convention.
// ---------------------------------------------------------------------------

const twoItemLabel = 'first item long enough, second item also long enough';
const twoItemLines = resolveChipLines(twoItemLabel, true);
assert(!twoItemLines.hasHiddenLabel, 'FAIL: a two-item authored label must not be hidden');
assert(
  twoItemLines.lines.length === 2
    && twoItemLines.lines[0] === 'first item long enough'
    && twoItemLines.lines[1] === 'second item also long enough',
  `FAIL: a two-item authored label should break into 2 full, untruncated lines, got ${JSON.stringify(twoItemLines.lines)}`,
);
console.log('PASS: a two-item authored label breaks into one full line per item');

// ---------------------------------------------------------------------------
// 8. resolveIoRowCells: IoTable's row for a labelled db: entry shows the
//    label in place of its column list; an unlabelled entry is unaffected.
// ---------------------------------------------------------------------------

const labelledDbCells = resolveIoRowCells(orderInput!, orderInput!.from);
assert(
  labelledDbCells.length === 1 && labelledDbCells[0]!.text === 'order lookup' && labelledDbCells[0]!.isColumn === false,
  `FAIL: IoTable row for a labelled db: entry should show one label row, got ${JSON.stringify(labelledDbCells)}`,
);

const unlabelledDbCells = resolveIoRowCells(logOutput!, logOutput!.to);
assert(
  unlabelledDbCells.length === 2 && unlabelledDbCells.every(c => c.isColumn),
  `FAIL: IoTable row for an unlabelled db: entry should keep one row per column, got ${JSON.stringify(unlabelledDbCells)}`,
);

const labelledExtCells = resolveIoRowCells(shopperOutput!, shopperOutput!.to);
assert(
  labelledExtCells.length === 1 && labelledExtCells[0]!.text === 'order confirmed',
  `FAIL: IoTable row for a labelled ext: entry should show the label, got ${JSON.stringify(labelledExtCells)}`,
);
console.log('PASS: IoTable row shows the label for a labelled entry, else today\'s rendering');

// ---------------------------------------------------------------------------
// 9. normalizeEdgeData: a non-array data string splits on ", " only at paren
//    depth zero — a prose item's own parenthesized list stays one line.
// ---------------------------------------------------------------------------

const proseWithParens = normalizeEdgeData('new tag (name, description, reason, provenance_id)');
assert(
  proseWithParens.length === 1 && proseWithParens[0] === 'new tag (name, description, reason, provenance_id)',
  `FAIL: a parenthesized item should stay one line, got ${JSON.stringify(proseWithParens)}`,
);

const plainTwoItems = normalizeEdgeData('a, b');
assert(
  plainTwoItems.length === 2 && plainTwoItems[0] === 'a' && plainTwoItems[1] === 'b',
  `FAIL: a plain top-level ", " should still split into two items, got ${JSON.stringify(plainTwoItems)}`,
);
console.log('PASS: normalizeEdgeData splits only at paren depth zero');

console.log('\nAll flow-edge-label tests passed.');
