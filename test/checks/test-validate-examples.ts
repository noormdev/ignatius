/**
 * test-validate-examples.ts — verifies the entity.example_unknown_column rule
 * and the liveOnly filter in formatFindingsForStderr.
 *
 * All assertions use plain Model literals (no fixture files) following the
 * shape of test-validate-entity.ts.
 */

import { validateModel, formatFindingsForStderr, RULES } from '../../src/model/validate';
import type { Model, ModelNode, ModelEdge } from '../../src/model/parse';

// ---------------------------------------------------------------------------
// Helpers (mirror test-validate-entity.ts)
// ---------------------------------------------------------------------------

function baseNode(overrides: Partial<ModelNode> & { id: string }): ModelNode {
  return {
    id: overrides.id,
    classification: overrides.classification ?? 'independent',
    group: overrides.group,
    pk: overrides.pk ?? ['id'],
    columns: overrides.columns ?? { id: { type: 'uuid' } },
    alternateKeys: overrides.alternateKeys ?? [],
    bodyHtml: overrides.bodyHtml ?? '',
    ...(overrides.examples !== undefined ? { examples: overrides.examples } : {}),
  };
}

function baseModel(nodes: ModelNode[], edges: ModelEdge[] = []): Model {
  return {
    groups: { core: { label: 'Core', color: '#aaa' } },
    nodes,
    edges,
    subtypeClusters: [],
    theme: {} as Model['theme'],
    branding: {} as Model['branding'],
  };
}

function hasError(result: ReturnType<typeof validateModel>, ruleId: string, entityId?: string): boolean {
  return result.entityErrors.some(
    e => e.ruleId === ruleId && (entityId === undefined || e.entityId === entityId),
  );
}

function countErrors(result: ReturnType<typeof validateModel>, ruleId: string, entityId?: string): number {
  return result.entityErrors.filter(
    e => e.ruleId === ruleId && (entityId === undefined || e.entityId === entityId),
  ).length;
}

// Hard assert that exits non-zero on failure (console.assert does NOT in Bun)
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// entity.example_unknown_column — RULE REGISTRY
// ---------------------------------------------------------------------------

{
  const entry = RULES['entity.example_unknown_column'];
  assert(entry !== undefined, 'FAIL: RULES[entity.example_unknown_column] missing');
  assert(typeof entry.title === 'string' && entry.title.length > 0, 'FAIL: RULES[entity.example_unknown_column].title empty');
  assert(typeof entry.explanation === 'string' && entry.explanation.length > 0, 'FAIL: RULES[entity.example_unknown_column].explanation empty');
  assert(entry.class === 'A', `FAIL: RULES[entity.example_unknown_column].class should be 'A', got '${entry.class}'`);
  assert(entry.liveOnly === true, `FAIL: RULES[entity.example_unknown_column].liveOnly should be true, got ${entry.liveOnly}`);
  console.log('PASS: RULES[entity.example_unknown_column] has correct shape with liveOnly: true');
}

// ---------------------------------------------------------------------------
// Positive: row with all known keys → zero findings
// ---------------------------------------------------------------------------

{
  // Keys: pk col 'id' + declared column 'name' + declared column 'status'
  const node = baseNode({
    id: 'Customer',
    pk: ['id'],
    columns: { id: { type: 'uuid' }, name: { type: 'text' }, status: { type: 'text' } },
    examples: [
      { id: '1', name: 'Alice', status: 'active' },
      { id: '2', name: 'Bob', status: 'inactive' },
    ],
  });
  const result = validateModel(baseModel([node]));
  assert(
    !hasError(result, 'entity.example_unknown_column', 'Customer'),
    'FAIL: entity.example_unknown_column — valid keys wrongly flagged',
  );
  console.log('PASS: entity.example_unknown_column negative (all keys valid)');
}

// ---------------------------------------------------------------------------
// Positive: row with only PK keys (sparse — missing column keys) → zero findings
// ---------------------------------------------------------------------------

{
  // Sparse: example row only has 'id'; 'name' and 'status' are absent — that is fine
  const node = baseNode({
    id: 'Product',
    pk: ['id'],
    columns: { id: { type: 'uuid' }, name: { type: 'text' }, status: { type: 'text' } },
    examples: [{ id: '42' }],
  });
  const result = validateModel(baseModel([node]));
  assert(
    !hasError(result, 'entity.example_unknown_column', 'Product'),
    'FAIL: entity.example_unknown_column — sparse row (missing keys) wrongly flagged',
  );
  console.log('PASS: entity.example_unknown_column negative (sparse row, missing keys ok)');
}

// ---------------------------------------------------------------------------
// Positive: examples field absent → zero findings
// ---------------------------------------------------------------------------

{
  const node = baseNode({ id: 'Tag', pk: ['tag_id'], columns: { tag_id: { type: 'uuid' } } });
  const result = validateModel(baseModel([node]));
  assert(
    !hasError(result, 'entity.example_unknown_column', 'Tag'),
    'FAIL: entity.example_unknown_column — absent examples wrongly flagged',
  );
  console.log('PASS: entity.example_unknown_column negative (examples absent)');
}

// ---------------------------------------------------------------------------
// Positive: examples is empty array → zero findings
// ---------------------------------------------------------------------------

{
  const node = baseNode({
    id: 'Tag',
    pk: ['tag_id'],
    columns: { tag_id: { type: 'uuid' } },
    examples: [],
  });
  const result = validateModel(baseModel([node]));
  assert(
    !hasError(result, 'entity.example_unknown_column', 'Tag'),
    'FAIL: entity.example_unknown_column — empty examples array wrongly flagged',
  );
  console.log('PASS: entity.example_unknown_column negative (empty examples array)');
}

// ---------------------------------------------------------------------------
// Negative: row with one extra key → one finding
// ---------------------------------------------------------------------------

{
  const node = baseNode({
    id: 'Order',
    pk: ['order_id'],
    columns: { order_id: { type: 'uuid' }, total: { type: 'numeric' } },
    // 'ghost_col' is NOT in pk or columns
    examples: [{ order_id: '1', total: 100, ghost_col: 'oops' }],
  });
  const result = validateModel(baseModel([node]));
  assert(
    hasError(result, 'entity.example_unknown_column', 'Order'),
    'FAIL: entity.example_unknown_column — extra key not flagged',
  );
  assert(
    countErrors(result, 'entity.example_unknown_column', 'Order') === 1,
    `FAIL: entity.example_unknown_column — expected 1 finding for 'ghost_col', got ${countErrors(result, 'entity.example_unknown_column', 'Order')}`,
  );
  console.log('PASS: entity.example_unknown_column positive (one extra key → one finding)');
}

// ---------------------------------------------------------------------------
// Negative: row with multiple extra keys → one finding per offending key
// ---------------------------------------------------------------------------

{
  const node = baseNode({
    id: 'Invoice',
    pk: ['invoice_id'],
    columns: { invoice_id: { type: 'uuid' }, amount: { type: 'numeric' } },
    // 'foo' and 'bar' are both unknown
    examples: [{ invoice_id: '99', amount: 500, foo: 'x', bar: 'y' }],
  });
  const result = validateModel(baseModel([node]));
  assert(
    countErrors(result, 'entity.example_unknown_column', 'Invoice') === 2,
    `FAIL: entity.example_unknown_column — expected 2 findings (one per extra key), got ${countErrors(result, 'entity.example_unknown_column', 'Invoice')}`,
  );
  console.log('PASS: entity.example_unknown_column positive (two extra keys → two findings)');
}

// ---------------------------------------------------------------------------
// Negative: extra key appears in multiple rows → one finding per occurrence
//
// Design decision: emit per occurrence (row × key), not per unique key.
// Rationale: the author sees each bad data point explicitly, not just a hint
// that "this key appears somewhere". This matches how the rule message cites
// both the row index and the key name.
// ---------------------------------------------------------------------------

{
  const node = baseNode({
    id: 'Payment',
    pk: ['payment_id'],
    columns: { payment_id: { type: 'uuid' }, amount: { type: 'numeric' } },
    // 'mystery' appears in two separate rows
    examples: [
      { payment_id: '1', amount: 10, mystery: 'a' },
      { payment_id: '2', amount: 20, mystery: 'b' },
    ],
  });
  const result = validateModel(baseModel([node]));
  assert(
    countErrors(result, 'entity.example_unknown_column', 'Payment') === 2,
    `FAIL: entity.example_unknown_column — expected 2 findings (per occurrence), got ${countErrors(result, 'entity.example_unknown_column', 'Payment')}`,
  );
  console.log('PASS: entity.example_unknown_column positive (extra key in 2 rows → 2 findings)');
}

// ---------------------------------------------------------------------------
// cleanedModel: offending examples rows are retained unchanged (advisory rule)
// ---------------------------------------------------------------------------

{
  const examples = [{ order_id: '1', total: 100, ghost_col: 'oops' }];
  const node = baseNode({
    id: 'Order',
    pk: ['order_id'],
    columns: { order_id: { type: 'uuid' }, total: { type: 'numeric' } },
    examples,
  });
  const model = baseModel([node]);
  const result = validateModel(model);

  const cleanedNode = result.cleanedModel.nodes.find(n => n.id === 'Order');
  assert(cleanedNode !== undefined, 'FAIL: cleanedModel missing Order node');
  assert(
    cleanedNode.examples === examples,
    'FAIL: cleanedModel.nodes[i].examples should be the same array reference (advisory, non-destructive)',
  );
  console.log('PASS: cleanedModel retains offending examples rows unchanged');
}

// ---------------------------------------------------------------------------
// formatFindingsForStderr: liveOnly findings are omitted
// ---------------------------------------------------------------------------

{
  // Simulate a live-only EntityError (entity.example_unknown_column)
  const liveOnlyError = {
    ruleId: 'entity.example_unknown_column' as const,
    entityId: 'Order',
    severity: 'warning' as const,
    message: "Entity 'Order' example row 0 contains unknown key 'ghost_col'.",
  };

  const lines = formatFindingsForStderr([], [liveOnlyError]);
  assert(
    lines.length === 0,
    `FAIL: formatFindingsForStderr — liveOnly finding should be omitted, got ${lines.length} lines`,
  );
  console.log('PASS: formatFindingsForStderr omits liveOnly findings (live-only EntityError → empty output)');
}

// ---------------------------------------------------------------------------
// formatFindingsForStderr: mixed (liveOnly + normal) → only non-liveOnly rows
// ---------------------------------------------------------------------------

{
  const liveOnlyError = {
    ruleId: 'entity.example_unknown_column' as const,
    entityId: 'Order',
    severity: 'warning' as const,
    message: "Entity 'Order' example row 0 contains unknown key 'ghost_col'.",
  };
  const normalError = {
    ruleId: 'entity.missing_pk' as const,
    entityId: 'Tag',
    severity: 'warning' as const,
    message: "Entity 'Tag' has no primary-key columns (pk is empty).",
  };

  const lines = formatFindingsForStderr([], [liveOnlyError, normalError]);
  assert(
    lines.length === 1,
    `FAIL: formatFindingsForStderr — expected 1 line (non-liveOnly only), got ${lines.length}`,
  );
  assert(
    lines[0]!.includes('entity.missing_pk'),
    `FAIL: formatFindingsForStderr — expected line to contain entity.missing_pk, got: ${lines[0]}`,
  );
  assert(
    !lines[0]!.includes('entity.example_unknown_column'),
    `FAIL: formatFindingsForStderr — liveOnly rule leaked into output: ${lines[0]}`,
  );
  console.log('PASS: formatFindingsForStderr omits liveOnly rows; non-liveOnly rows appear normally');
}

console.log('\nAll entity.example_unknown_column validation tests passed.');
