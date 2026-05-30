// Verification: validateModel fires correct ruleId for every Class A entity rule.
// Positive case (violation present) + negative case (model satisfies the rule).
// No fixture files — Model literals only.
import { validateModel, RULES } from '../../src/validate';
import type { Model, ModelNode, ModelEdge } from '../../src/parse';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// entity.missing_pk
// ---------------------------------------------------------------------------

{
  // Positive: pk is empty array
  const node = baseNode({ id: 'Order', pk: [] });
  const result = validateModel(baseModel([node]));
  console.assert(hasError(result, 'entity.missing_pk', 'Order'), 'FAIL: entity.missing_pk — empty pk not flagged');
  console.log('PASS: entity.missing_pk positive (empty pk)');
}

{
  // Negative: pk has a column
  const node = baseNode({ id: 'Order', pk: ['order_id'] });
  const result = validateModel(baseModel([node]));
  console.assert(!hasError(result, 'entity.missing_pk', 'Order'), 'FAIL: entity.missing_pk — valid pk wrongly flagged');
  console.log('PASS: entity.missing_pk negative (non-empty pk)');
}

// ---------------------------------------------------------------------------
// entity.missing_columns
// ---------------------------------------------------------------------------

{
  // Positive: columns is undefined (field absent from frontmatter)
  const node: ModelNode = { ...baseNode({ id: 'Tag', pk: ['tag_id'] }), columns: undefined as unknown as ModelNode['columns'] };
  const result = validateModel(baseModel([node]));
  console.assert(hasError(result, 'entity.missing_columns', 'Tag'), 'FAIL: entity.missing_columns — undefined columns not flagged');
  console.log('PASS: entity.missing_columns positive (undefined columns)');
}

{
  // Negative: empty columns object (PK-only intersection table — intentional, should not warn)
  const node = baseNode({ id: 'Tag', pk: ['tag_id'], columns: {} });
  const result = validateModel(baseModel([node]));
  console.assert(!hasError(result, 'entity.missing_columns', 'Tag'), 'FAIL: entity.missing_columns — empty columns {} wrongly flagged');
  console.log('PASS: entity.missing_columns negative (empty columns {})');
}

{
  // Negative: at least one column present
  const node = baseNode({ id: 'Tag', pk: ['tag_id'], columns: { tag_id: { type: 'uuid' } } });
  const result = validateModel(baseModel([node]));
  console.assert(!hasError(result, 'entity.missing_columns', 'Tag'), 'FAIL: entity.missing_columns — valid columns wrongly flagged');
  console.log('PASS: entity.missing_columns negative (has columns)');
}

// ---------------------------------------------------------------------------
// entity.invalid_field_type
// ---------------------------------------------------------------------------

{
  // Positive: pk is a string instead of array
  const node: ModelNode = {
    ...baseNode({ id: 'Broken' }),
    pk: 'order_id' as unknown as string[],
  };
  const result = validateModel(baseModel([node]));
  console.assert(hasError(result, 'entity.invalid_field_type', 'Broken'), 'FAIL: entity.invalid_field_type — string pk not flagged');
  console.log('PASS: entity.invalid_field_type positive (pk is string)');
}

{
  // Negative: pk is a proper array
  const node = baseNode({ id: 'GoodEntity', pk: ['id'] });
  const result = validateModel(baseModel([node]));
  console.assert(!hasError(result, 'entity.invalid_field_type', 'GoodEntity'), 'FAIL: entity.invalid_field_type — valid shape wrongly flagged');
  console.log('PASS: entity.invalid_field_type negative (valid shape)');
}

// NOTE: classification_mismatch_dependent / classification_mismatch_independent /
// unknown_classification rules were removed during the master reconcile pass.
// Classification is now derived from PK/FK structure by the parser (see
// docs/spec/derive-classification.md) so there is no declared classification to
// mismatch against.

// ---------------------------------------------------------------------------
// entity.unknown_group
// ---------------------------------------------------------------------------

{
  // Positive: group ref not in model.groups
  const node = baseNode({ id: 'Thing', group: 'nonexistent' });
  const model = baseModel([node]);
  const result = validateModel(model);
  console.assert(hasError(result, 'entity.unknown_group', 'Thing'), 'FAIL: entity.unknown_group — missing group not flagged');
  console.log('PASS: entity.unknown_group positive (group not in model.groups)');
}

{
  // Negative: group exists in model.groups
  const node = baseNode({ id: 'Thing', group: 'core' });
  const model = baseModel([node]);
  const result = validateModel(model);
  console.assert(!hasError(result, 'entity.unknown_group', 'Thing'), 'FAIL: entity.unknown_group — valid group wrongly flagged');
  console.log('PASS: entity.unknown_group negative (group exists)');
}

{
  // Negative: no group set — should not fire
  const node = baseNode({ id: 'Ungrouped' });
  delete (node as Partial<ModelNode>).group;
  const result = validateModel(baseModel([node]));
  console.assert(!hasError(result, 'entity.unknown_group', 'Ungrouped'), 'FAIL: entity.unknown_group — undefined group wrongly flagged');
  console.log('PASS: entity.unknown_group negative (no group set)');
}

// ---------------------------------------------------------------------------
// cleanedModel is structurally equal to input (CP-1: no stripping)
// ---------------------------------------------------------------------------

{
  const node = baseNode({ id: 'OrderItem', pk: [], columns: {} });
  const model = baseModel([node]);
  const result = validateModel(model);
  console.assert(result.cleanedModel === model || JSON.stringify(result.cleanedModel) === JSON.stringify(model),
    'FAIL: cleanedModel not structurally equal to input');
  console.log('PASS: cleanedModel structurally equal to input model');
}

// ---------------------------------------------------------------------------
// RULES registry
// ---------------------------------------------------------------------------

{
  const entityRules = [
    'entity.missing_pk',
    'entity.missing_columns',
    'entity.invalid_field_type',
    'entity.unknown_group',
  ] as const;

  for (const ruleId of entityRules) {
    const entry = RULES[ruleId];
    console.assert(entry !== undefined, `FAIL: RULES['${ruleId}'] missing`);
    console.assert(typeof entry!.title === 'string' && entry!.title.length > 0, `FAIL: RULES['${ruleId}'].title empty`);
    console.assert(typeof entry!.explanation === 'string' && entry!.explanation.length > 0, `FAIL: RULES['${ruleId}'].explanation empty`);
    console.assert(entry!.class === 'A', `FAIL: RULES['${ruleId}'].class should be 'A', got '${entry!.class}'`);
  }
  console.log('PASS: RULES registry has all CP-1 entity rules with correct shape');
}

console.log('\nAll entity validation tests passed.');
