/**
 * CP-1: derive `identifying` and `classification` in parse.ts from PK+FK structure
 * and subtype-cluster membership.
 *
 * Tests encode explicit expected truth against models/ — NOT "derived == declared".
 * This ensures the test survives CP-2 when hand-authored fields are stripped.
 */

import { parseModels } from '../../src/parse';

const model = await parseModels('models/key-inherited');

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Build fast-lookup maps
const nodeById: Record<string, string> = {};
for (const node of model.nodes) {
  nodeById[node.id] = node.classification;
}

// ─── Classification assertions ────────────────────────────────────────────────

const expectedClassifier = ['PartyType', 'LineItemType', 'PaymentMethodType'];
for (const id of expectedClassifier) {
  assert(
    nodeById[id] === 'Classifier',
    `${id} should be Classifier (got: ${nodeById[id]})`,
  );
}

const expectedSubtype = [
  'Business', 'Person',
  'License', 'Passport', 'SSN', 'ITIN',
  'SIL_Product', 'SIL_Subscription',
  'SOL_Product', 'SOL_Subscription',
];
for (const id of expectedSubtype) {
  assert(
    nodeById[id] === 'Subtype',
    `${id} should be Subtype (got: ${nodeById[id]})`,
  );
}

const expectedAssociative = ['PaymentAllocation'];
for (const id of expectedAssociative) {
  assert(
    nodeById[id] === 'Associative',
    `${id} should be Associative (got: ${nodeById[id]})`,
  );
}

const expectedDependent = [
  'Identity', 'PaymentMethod', 'Payment',
  'SalesOrder', 'SalesInvoice', 'SI_Line', 'SO_Line',
];
for (const id of expectedDependent) {
  assert(
    nodeById[id] === 'Dependent',
    `${id} should be Dependent (got: ${nodeById[id]})`,
  );
}

const expectedIndependent = ['Party', 'Product', 'Subscription'];
for (const id of expectedIndependent) {
  assert(
    nodeById[id] === 'Independent',
    `${id} should be Independent (got: ${nodeById[id]})`,
  );
}

// Verify total count: 3 + 10 + 1 + 7 + 3 = 24
assert(
  model.nodes.length === 24,
  `total node count should be 24 (got: ${model.nodes.length})`,
);

// ─── Identifying relationship assertions ─────────────────────────────────────

// Build edge lookup: "source→target" → identifying
const edgeMap: Record<string, boolean> = {};
for (const edge of model.edges) {
  edgeMap[`${edge.source}→${edge.target}`] = edge.identifying;
}

// Identifying: FK cols ⊆ PK of child (source)
const shouldBeIdentifying = [
  ['Identity', 'Party'],       // Identity.pk=[party_id], FK on party_id
  ['License', 'Identity'],     // License.pk=[party_id], FK on party_id
  ['SalesOrder', 'Party'],     // SalesOrder.pk=[party_id, sales_order_id], FK on party_id (subset)
  ['SI_Line', 'SalesInvoice'], // SI_Line.pk=[party_id, sales_invoice_id, line_seq], FK on party_id + sales_invoice_id (subset)
  ['PaymentAllocation', 'Payment'],   // FK party_id+payment_method_id+payment_id all in PA.pk
  ['PaymentAllocation', 'SI_Line'],   // FK party_id+sales_invoice_id+line_seq all in PA.pk
  // Subtype "is a" relationships should be identifying
  ['Business', 'Party'],
  ['Person', 'Party'],
  ['Passport', 'Identity'],
  ['SSN', 'Identity'],
  ['ITIN', 'Identity'],
  ['SIL_Product', 'SI_Line'],
  ['SIL_Subscription', 'SI_Line'],
  ['SOL_Product', 'SO_Line'],
  ['SOL_Subscription', 'SO_Line'],
];
for (const [src, tgt] of shouldBeIdentifying) {
  const key = `${src}→${tgt}`;
  assert(
    edgeMap[key] === true,
    `${key} should be identifying (got: ${edgeMap[key]})`,
  );
}

// Non-identifying: FK cols NOT ⊆ PK
const shouldBeNonIdentifying = [
  ['Party', 'PartyType'],              // type col not in Party.pk=[party_id]
  ['PaymentMethod', 'PaymentMethodType'], // type col not in PaymentMethod.pk
  ['SI_Line', 'LineItemType'],         // type col not in SI_Line.pk
  ['SIL_Product', 'Product'],          // product_id not in SIL_Product.pk
];
for (const [src, tgt] of shouldBeNonIdentifying) {
  const key = `${src}→${tgt}`;
  assert(
    edgeMap[key] === false,
    `${key} should be non-identifying (got: ${edgeMap[key]})`,
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll derive-classification assertions passed.');
}
