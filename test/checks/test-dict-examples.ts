/**
 * test-dict-examples.ts — verifies the dict examples accordion render (CP-3).
 *
 * Uses plain Model literals (no fixture files). Covers:
 *   - <details class="dict-examples"> present for entities with examples
 *   - No accordion emitted for entities with undefined/empty examples
 *   - Content (values from example rows) appears in the accordion region
 *   - `open` attribute present for ≤ 3 rows, absent for > 3 rows
 *   - liveOnly findings omitted from findings banner when surface === 'static'
 *   - liveOnly findings included when surface === 'live'
 */

import { generateDict } from '../../src/generators/dict';
import { mergeTheme } from '../../src/theme-defaults';
import { mergeBranding } from '../../src/branding-defaults';
import type { Model, ModelNode } from '../../src/parse';
import type { EntityError } from '../../src/validate';

// Hard assert — exits non-zero on failure (console.assert does NOT in Bun)
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

// ---------------------------------------------------------------------------
// Minimal model factory (no parse.ts I/O needed — plain literals)
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<ModelNode> & { id: string }): ModelNode {
  return {
    id: overrides.id,
    classification: overrides.classification ?? 'independent',
    group: overrides.group ?? 'core',
    pk: overrides.pk ?? ['id'],
    columns: overrides.columns ?? { id: { type: 'uuid' } },
    alternateKeys: overrides.alternateKeys ?? [],
    bodyHtml: overrides.bodyHtml ?? '',
    ...(overrides.examples !== undefined ? { examples: overrides.examples } : {}),
  };
}

function makeModel(nodes: ModelNode[]): Model {
  return {
    groups: { core: { label: 'Core', color: '#888' } },
    nodes,
    edges: [],
    subtypeClusters: [],
    theme: mergeTheme({}),
    branding: mergeBranding({ poweredBy: false }),
  };
}

const noFindings = { globalErrors: [], entityErrors: [] };

// ---------------------------------------------------------------------------
// 1. Entity WITH examples (2 rows): accordion present + open + content visible
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Customer',
    pk: ['id'],
    columns: { id: { type: 'uuid' }, name: { type: 'text' } },
    examples: [
      { id: 1, name: 'Acme' },
      { id: 2, name: 'Globex' },
    ],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  assert(
    html.includes('<details class="dict-examples"'),
    'entity with 2-row examples renders <details class="dict-examples">',
  );
  // ≤ 3 rows → open attribute present
  assert(
    html.includes('<details class="dict-examples" open'),
    'entity with ≤3 rows has open attribute on <details>',
  );
  // Row values appear in the accordion region
  assert(
    html.includes('Acme'),
    'entity examples: "Acme" from example row appears in output',
  );
}

// ---------------------------------------------------------------------------
// 2. Entity WITHOUT examples (undefined): no accordion emitted
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Tag',
    pk: ['tag_id'],
    columns: { tag_id: { type: 'uuid' }, label: { type: 'text' } },
    // examples: undefined (not set)
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  assert(
    !html.includes('<details class="dict-examples"'),
    'entity with no examples: <details class="dict-examples"> element absent from output',
  );
}

// ---------------------------------------------------------------------------
// 3. Entity with empty examples array: no accordion emitted
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Tag',
    pk: ['tag_id'],
    columns: { tag_id: { type: 'uuid' } },
    examples: [],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  assert(
    !html.includes('<details class="dict-examples"'),
    'entity with empty examples array: <details class="dict-examples"> element absent from output',
  );
}

// ---------------------------------------------------------------------------
// 4. Entity with > 3 rows: accordion NOT open by default
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Product',
    pk: ['id'],
    columns: { id: { type: 'uuid' }, name: { type: 'text' } },
    examples: [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
      { id: 4, name: 'D' }, // 4 rows → closed
    ],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  assert(
    html.includes('<details class="dict-examples"'),
    'entity with 4-row examples renders accordion',
  );
  assert(
    !html.includes('<details class="dict-examples" open'),
    'entity with >3 rows does NOT have open attribute on <details>',
  );
}

// ---------------------------------------------------------------------------
// 5. Exactly 3 rows: accordion IS open (boundary case — ≤ 3 means open)
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Order',
    pk: ['order_id'],
    columns: { order_id: { type: 'uuid' }, total: { type: 'numeric' } },
    examples: [
      { order_id: '1', total: 100 },
      { order_id: '2', total: 200 },
      { order_id: '3', total: 300 },
    ],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  assert(
    html.includes('<details class="dict-examples" open'),
    'entity with exactly 3 rows has open attribute (boundary: ≤ 3 is open)',
  );
}

// ---------------------------------------------------------------------------
// 6. surface === 'static' (default): liveOnly findings omitted from banner
// ---------------------------------------------------------------------------

{
  const node = makeNode({ id: 'Foo', pk: ['id'], columns: { id: { type: 'uuid' } } });
  const liveOnlyError: EntityError = {
    ruleId: 'entity.example_unknown_column',
    entityId: 'Foo',
    severity: 'warning',
    message: "Entity 'Foo' example row 0 contains unknown key 'ghost'.",
  };

  // surface unset → defaults to 'static'
  const html = await generateDict(
    makeModel([node]),
    { globalErrors: [], entityErrors: [liveOnlyError] },
    'dark',
    { modelsDir: '/tmp/x' },
  );

  // The liveOnly finding should NOT appear in the findings panel
  assert(
    !html.includes('example_unknown_column'),
    'surface=static (default): liveOnly finding absent from findings banner',
  );
}

// ---------------------------------------------------------------------------
// 7. surface === 'static' explicit: same suppression
// ---------------------------------------------------------------------------

{
  const node = makeNode({ id: 'Foo', pk: ['id'], columns: { id: { type: 'uuid' } } });
  const liveOnlyError: EntityError = {
    ruleId: 'entity.example_unknown_column',
    entityId: 'Foo',
    severity: 'warning',
    message: "Entity 'Foo' example row 0 contains unknown key 'ghost'.",
  };

  const html = await generateDict(
    makeModel([node]),
    { globalErrors: [], entityErrors: [liveOnlyError] },
    'dark',
    { modelsDir: '/tmp/x', surface: 'static' },
  );

  assert(
    !html.includes('example_unknown_column'),
    'surface=static explicit: liveOnly finding absent from findings banner',
  );
}

// ---------------------------------------------------------------------------
// 8. surface === 'live': liveOnly findings ARE included in banner
// ---------------------------------------------------------------------------

{
  const node = makeNode({ id: 'Foo', pk: ['id'], columns: { id: { type: 'uuid' } } });
  const liveOnlyError: EntityError = {
    ruleId: 'entity.example_unknown_column',
    entityId: 'Foo',
    severity: 'warning',
    message: "Entity 'Foo' example row 0 contains unknown key 'ghost'.",
  };

  const html = await generateDict(
    makeModel([node]),
    { globalErrors: [], entityErrors: [liveOnlyError] },
    'dark',
    { modelsDir: '/tmp/x', surface: 'live' },
  );

  assert(
    html.includes('example_unknown_column') || html.includes('Example row contains unknown column'),
    'surface=live: liveOnly finding IS included in findings banner',
  );
}

// ---------------------------------------------------------------------------
// 9. PK columns appear before declared columns in table header
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Item',
    pk: ['item_id', 'order_id'],
    columns: {
      item_id: { type: 'uuid' },
      order_id: { type: 'uuid' },
      qty: { type: 'int' },
    },
    examples: [{ item_id: '1', order_id: '2', qty: 5 }],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  const exStart = html.indexOf('class="dict-examples"');
  assert(exStart >= 0, 'Item entity: dict-examples block present');

  const exRegion = html.slice(exStart, exStart + 2000);
  const itemIdPos = exRegion.indexOf('item_id');
  const qtyPos = exRegion.indexOf('qty');
  assert(
    itemIdPos >= 0 && qtyPos >= 0 && itemIdPos < qtyPos,
    'PK column (item_id) appears before declared column (qty) in examples header',
  );
}

// ---------------------------------------------------------------------------
// 10. Missing values in sparse rows render en-dash placeholder
// ---------------------------------------------------------------------------

{
  const node = makeNode({
    id: 'Product',
    pk: ['id'],
    columns: { id: { type: 'uuid' }, name: { type: 'text' }, code: { type: 'text' } },
    // First row omits 'code'
    examples: [{ id: '1', name: 'Widget' }],
  });
  const html = await generateDict(makeModel([node]), noFindings, 'dark', { modelsDir: '/tmp/x' });

  const exStart = html.indexOf('class="dict-examples"');
  const exRegion = html.slice(exStart, exStart + 2000);
  assert(
    exRegion.includes('dict-example-empty'),
    'sparse row missing value renders with dict-example-empty class',
  );
}

console.log('\nAll test-dict-examples checks passed.');
