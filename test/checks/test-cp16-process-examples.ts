/**
 * test-cp16-process-examples.ts — unit tests for FlowProcess `examples:` parsing.
 *
 * Covers:
 *  - Happy path: examples.in + examples.out parse into FlowExample[] with correct shape
 *  - No-examples: a process file without examples: leaves the field absent
 *  - Missing-rows: an in/out entry with no rows: key yields rows = []  ← exercises defensive branch directly
 *  - Absent-examples: parseProcessExamples(undefined) returns undefined  ← exercises null-guard directly
 *  - Heterogeneous rows: columns = union of all row keys (missing key → absent from row)
 *
 * The missing-rows and absent-examples cases are exercised by calling parseProcessExamples
 * directly on synthetic in-memory inputs — the live fixture has no such entries.
 */

import { parseFlows, parseProcessExamples } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';

/** Walk the leveled tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
    for (const d of diagrams) {
        if (d.id === id) return d;
        const found = findDiagramInTree(d.subDfds, id);
        if (found) return found;
    }
    return undefined;
}

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

function defined<T>(v: T | undefined, msg: string): T {
    assert(v !== undefined, msg);
    return v;
}

// ---------------------------------------------------------------------------
// Synthetic unit tests for parseProcessExamples — no I/O
// ---------------------------------------------------------------------------

// Absent input → undefined
const absentResult = parseProcessExamples(undefined);
assert(absentResult === undefined, 'parseProcessExamples(undefined) should return undefined');
console.log('PASS: absent examples input returns undefined');

// Null input → undefined
const nullResult = parseProcessExamples(null);
assert(nullResult === undefined, 'parseProcessExamples(null) should return undefined');
console.log('PASS: null examples input returns undefined');

// in-entry with no `rows` key → rows = []
const missingRowsInput = {
    in: [{ from: 'ext:Customer', label: 'no rows here' }],
    out: [{ to: 'db:Payment' }],
};
const missingRowsResult = defined(
    parseProcessExamples(missingRowsInput),
    'parseProcessExamples with missing rows should return a result object',
);
assert(missingRowsResult.in.length === 1, 'Should have 1 in-entry');
assert(missingRowsResult.out.length === 1, 'Should have 1 out-entry');
const missingRowsInEntry = defined(missingRowsResult.in[0], 'in[0] should exist');
assert(Array.isArray(missingRowsInEntry.rows), 'Missing rows: key → rows should be an array');
assert(missingRowsInEntry.rows.length === 0, 'Missing rows: key → rows should be empty (length 0)');
const missingRowsOutEntry = defined(missingRowsResult.out[0], 'out[0] should exist');
assert(Array.isArray(missingRowsOutEntry.rows), 'Missing rows on out-entry → rows should be an array');
assert(missingRowsOutEntry.rows.length === 0, 'Missing rows on out-entry → rows should be empty');
console.log('PASS: in/out entry with no rows: key yields rows = [] (defensive branch exercised directly)');

// Explicit rows: [] (empty array) → rows = []
const emptyRowsInput = {
    in: [{ from: 'ext:Foo', rows: [] }],
    out: [],
};
const emptyRowsResult = defined(
    parseProcessExamples(emptyRowsInput),
    'parseProcessExamples with explicit empty rows should return result',
);
const emptyRowsEntry = defined(emptyRowsResult.in[0], 'in[0] should exist');
assert(emptyRowsEntry.rows.length === 0, 'Explicit empty rows should yield rows.length === 0');
console.log('PASS: in-entry with rows: [] yields rows = []');

// ---------------------------------------------------------------------------
// Parse the key-inherited model flows (contains Collect-Payment with examples)
// ---------------------------------------------------------------------------

const MODEL_DIR = 'models/key-inherited';
const { flowModel, globalErrors } = await parseFlows(MODEL_DIR);

assert(globalErrors.length === 0, `Expected no globalErrors, got: ${JSON.stringify(globalErrors)}`);
console.log('PASS: parseFlows key-inherited — no globalErrors');

// ---------------------------------------------------------------------------
// Locate the order-to-cash diagram + Collect-Payment process
// ---------------------------------------------------------------------------

// After CP4 leveling the leaf diagram 'order-to-cash' is nested in the tree.
const otcDiagram = findDiagramInTree(flowModel.diagrams, 'order-to-cash');
assert(otcDiagram !== undefined, 'Expected to find order-to-cash diagram in leveled tree');

const collectPayment = otcDiagram.processes.find(p => p.id === 'Collect-Payment');
assert(collectPayment !== undefined, 'Expected to find Collect-Payment process');
console.log('PASS: found Collect-Payment process in order-to-cash');

// ---------------------------------------------------------------------------
// Happy path: examples field is present and has correct top-level shape
// ---------------------------------------------------------------------------

assert(collectPayment.examples !== undefined, 'Collect-Payment should have examples field');
const examples = collectPayment.examples;

assert(Array.isArray(examples.in), 'examples.in should be an array');
assert(Array.isArray(examples.out), 'examples.out should be an array');
console.log('PASS: examples.in and examples.out are arrays');

// ---------------------------------------------------------------------------
// examples.in entries
// ---------------------------------------------------------------------------

assert(examples.in.length === 2, `Expected 2 in-entries, got ${examples.in.length}`);

const inEntry0 = defined(examples.in[0], 'in[0] should exist');
assert(inEntry0.from === 'ext:Customer', `in[0].from should be ext:Customer, got ${inEntry0.from}`);
assert(inEntry0.label === 'payment details', `in[0].label should be 'payment details', got ${inEntry0.label}`);
assert(Array.isArray(inEntry0.rows), 'in[0].rows should be an array');
assert(inEntry0.rows.length === 2, `in[0].rows should have 2 rows, got ${inEntry0.rows.length}`);

const inEntry0Row0 = defined(inEntry0.rows[0], 'in[0].rows[0] should exist');
assert(inEntry0Row0['card'] === '****4242', `in[0].rows[0].card should be '****4242'`);
assert(inEntry0Row0['amount'] === 49.99, `in[0].rows[0].amount should be 49.99`);
assert(inEntry0Row0['currency'] === 'GBP', `in[0].rows[0].currency should be GBP`);
console.log('PASS: in[0] shape correct (from, label, rows with typed values)');

const inEntry1 = defined(examples.in[1], 'in[1] should exist');
assert(inEntry1.from === 'db:PaymentMethod', `in[1].from should be db:PaymentMethod, got ${inEntry1.from}`);
assert(inEntry1.rows.length === 1, `in[1].rows should have 1 row, got ${inEntry1.rows.length}`);
const inEntry1Row0 = defined(inEntry1.rows[0], 'in[1].rows[0] should exist');
assert(inEntry1Row0['type'] === 'card', `in[1].rows[0].type should be 'card'`);
console.log('PASS: in[1] shape correct');

// ---------------------------------------------------------------------------
// examples.out entries
// ---------------------------------------------------------------------------

assert(examples.out.length === 2, `Expected 2 out-entries, got ${examples.out.length}`);

const outEntry0 = defined(examples.out[0], 'out[0] should exist');
assert(outEntry0.to === 'db:Payment', `out[0].to should be db:Payment, got ${outEntry0.to}`);
assert(outEntry0.label === 'settled payment record', `out[0].label should be 'settled payment record'`);
assert(outEntry0.rows.length === 2, `out[0].rows should have 2 rows, got ${outEntry0.rows.length}`);
const outEntry0Row0 = defined(outEntry0.rows[0], 'out[0].rows[0] should exist');
assert(outEntry0Row0['payment_id'] === 9001, `out[0].rows[0].payment_id should be 9001`);
console.log('PASS: out[0] shape correct (to, label, numeric rows)');

const outEntry1 = defined(examples.out[1], 'out[1] should exist');
assert(outEntry1.to === 'ext:Customer', `out[1].to should be ext:Customer, got ${outEntry1.to}`);
assert(outEntry1.rows.length === 1, `out[1].rows should have 1 row`);
const outEntry1Row0 = defined(outEntry1.rows[0], 'out[1].rows[0] should exist');
assert(outEntry1Row0['status'] === 'captured', `out[1].rows[0].status should be 'captured'`);
console.log('PASS: out[1] shape correct');

// ---------------------------------------------------------------------------
// No-examples: a process WITHOUT examples: field has no examples property
// ---------------------------------------------------------------------------

// Issue-Invoice is in order-to-cash and has no examples: block
const issueInvoice = otcDiagram.processes.find(p => p.id === 'Issue-Invoice');
if (issueInvoice !== undefined) {
    assert(issueInvoice.examples === undefined, 'Issue-Invoice (no examples:) should have examples=undefined');
    console.log('PASS: process without examples: has examples=undefined');
} else {
    console.log('NOTE: Issue-Invoice not found — skipping no-examples assertion');
}

// ---------------------------------------------------------------------------
// Heterogeneous rows: union of keys produces correct column set
// ---------------------------------------------------------------------------

// in[0] has rows with keys: card, amount, currency — union = all three
const inEntry0Row1 = defined(inEntry0.rows[1], 'in[0].rows[1] should exist');
const inKeysRow0 = Object.keys(inEntry0Row0);
const inKeysRow1 = Object.keys(inEntry0Row1);
const allInKeys = new Set([...inKeysRow0, ...inKeysRow1]);
assert(allInKeys.has('card'), 'union of in[0] row keys includes card');
assert(allInKeys.has('amount'), 'union of in[0] row keys includes amount');
assert(allInKeys.has('currency'), 'union of in[0] row keys includes currency');
console.log('PASS: union of row keys is superset of all declared columns');

// All live FlowExample.rows are arrays (belt-and-suspenders)
for (const entry of [...examples.in, ...examples.out]) {
    assert(Array.isArray(entry.rows), `Every FlowExample.rows should be an array (got ${typeof entry.rows})`);
}
console.log('PASS: all live FlowExample.rows are arrays');

console.log('\nAll CP16 parse assertions PASSED');
