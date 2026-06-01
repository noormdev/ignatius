// Verification: body.unknown_link fires for `[[…]]` body links whose target is
// not an entity, and stays quiet when every target resolves. Model literals only.
import { validateModel } from '../../src/validate';
import type { Model, ModelNode } from '../../src/parse';

function baseNode(overrides: Partial<ModelNode> & { id: string }): ModelNode {
  return {
    id: overrides.id,
    classification: overrides.classification ?? 'independent',
    group: overrides.group,
    pk: overrides.pk ?? ['id'],
    columns: overrides.columns ?? { id: { type: 'uuid' } },
    alternateKeys: overrides.alternateKeys ?? [],
    bodyHtml: overrides.bodyHtml ?? '',
    bodyLinks: overrides.bodyLinks,
  };
}

function baseModel(nodes: ModelNode[]): Model {
  return {
    groups: { core: { label: 'Core', color: '#aaa' } },
    nodes,
    edges: [],
    subtypeClusters: [],
    theme: {} as Model['theme'],
    branding: {} as Model['branding'],
  };
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

function bodyLinkErrors(r: ReturnType<typeof validateModel>, entityId: string): string[] {
  return r.entityErrors
    .filter(e => e.ruleId === 'body.unknown_link' && e.entityId === entityId)
    .map(e => e.message);
}

// Unknown target → one warning on the linking entity.
{
  const model = baseModel([
    baseNode({ id: 'Order', bodyLinks: ['Customer', 'Ghost'] }),
    baseNode({ id: 'Customer' }),
  ]);
  const errs = bodyLinkErrors(validateModel(model), 'Order');
  assert(errs.length === 1, `exactly one unknown-link warning (got ${errs.length}: ${JSON.stringify(errs)})`);
  assert(errs[0]!.includes('Ghost'), 'warning names the unknown target');
  console.log('PASS: unknown body link warns; known link is silent');
}

// Repeated unknown target → reported once, not per occurrence.
{
  const model = baseModel([baseNode({ id: 'Order', bodyLinks: ['Ghost', 'Ghost', 'Ghost'] })]);
  const errs = bodyLinkErrors(validateModel(model), 'Order');
  assert(errs.length === 1, `deduped to one warning (got ${errs.length})`);
  console.log('PASS: repeated unknown target deduped');
}

// All targets resolve → no body-link findings.
{
  const model = baseModel([
    baseNode({ id: 'Order', bodyLinks: ['Customer'] }),
    baseNode({ id: 'Customer', bodyLinks: ['Order'] }),
  ]);
  const r = validateModel(model);
  assert(bodyLinkErrors(r, 'Order').length === 0 && bodyLinkErrors(r, 'Customer').length === 0, 'no findings when all resolve');
  console.log('PASS: resolved links produce no findings');
}

// No bodyLinks at all → no findings (back-compat with bodies that have none).
{
  const model = baseModel([baseNode({ id: 'Order' })]);
  assert(bodyLinkErrors(validateModel(model), 'Order').length === 0, 'undefined bodyLinks is fine');
  console.log('PASS: absent bodyLinks produce no findings');
}

console.log('\nAll body-link validation checks passed.');
