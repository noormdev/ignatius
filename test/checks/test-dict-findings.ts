/**
 * test-dict-findings.ts — CP-3 dict surface integration of validation findings.
 *
 * Builds small literal Model fixtures, validates them, generates dict HTML,
 * and asserts that the expected error-UX markup is present.
 * No on-disk fixtures — pure Model literals, following the test/checks/ idiom.
 */

import { generateDict } from '../../src/generators/dict';
import { validateModel } from '../../src/validate';
import type { Model, ModelNode, ModelEdge } from '../../src/parse';
import { defaultBranding } from '../../src/branding-defaults';
import { defaultTheme } from '../../src/theme-defaults';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers — build minimal Model fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<ModelNode>): ModelNode {
  return {
    id: overrides.id ?? 'Thing',
    classification: overrides.classification ?? 'independent',
    pk: overrides.pk ?? ['id'],
    columns: overrides.columns ?? { id: { type: 'uuid', nullable: false } },
    group: overrides.group ?? undefined,
    bodyHtml: overrides.bodyHtml ?? '',
    branding: overrides.branding,
    theme: overrides.theme,
    ...overrides,
  } as ModelNode;
}

function makeModel(nodes: ModelNode[], edges: ModelEdge[] = []): Model {
  return {
    nodes,
    edges,
    subtypeClusters: [],
    groups: {},
    theme: defaultTheme,
    branding: defaultBranding,
  };
}

// ---------------------------------------------------------------------------
// Fixture A — model with one global error (edge.unknown_target) + one entity
// error (entity.missing_pk). This exercises the global banner and entity triangle.
// ---------------------------------------------------------------------------

const nodeA: ModelNode = makeNode({ id: 'Person', pk: [], columns: { name: { type: 'text', nullable: false } } });
const nodeB: ModelNode = makeNode({ id: 'Order', pk: ['person_id'], columns: { person_id: { type: 'uuid', nullable: false } } });

// Edge from Order → Hat (Hat not in model → edge.unknown_target GlobalError)
const edgeA: ModelEdge = {
  source: 'Order',
  target: 'Hat',
  on: { person_id: 'id' },
  identifying: false,
  predicate: { fwd: 'places', rev: 'placed by' },
  cardinality: { parent: '1', child: 'N' },
};

const modelA = makeModel([nodeA, nodeB], [edgeA]);

// ---------------------------------------------------------------------------
// Fixture B — clean model (no findings) — banner must be absent
// ---------------------------------------------------------------------------

const nodeClean: ModelNode = makeNode({ id: 'Widget', pk: ['id'], columns: { id: { type: 'uuid', nullable: false } } });
const modelB = makeModel([nodeClean]);

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

// --- Fixture A ---
const validationA = validateModel(modelA);
// Pass raw model (not cleanedModel) so missing-target FK links appear
const htmlA = await generateDict(
  modelA,
  { globalErrors: validationA.globalErrors, entityErrors: validationA.entityErrors },
  'dark',
  {},
);

// 1. Global banner is present when globalErrors exist
assert(htmlA.includes('<div class="dict-global-banner">'), 'global banner present when globalErrors exist');

// 2. Global banner row names the missing target edge
assert(htmlA.includes('Edge target not in model'), 'global banner contains rule title "Edge target not in model"');
assert(htmlA.includes('Hat'), 'global banner row references omitted entity "Hat"');

// 3. Per-entity triangle present for Person (has entity.missing_pk)
assert(htmlA.includes('class="dict-entity-warning"'), 'entity warning triangle class present for entity with errors');

// 4. <details> disclosure present for Person
assert(htmlA.includes('class="dict-entity-warning-detail"'), 'entity warning detail class present');

// 5. Triangle for Person lists the missing PK message
assert(htmlA.includes('Missing primary key') || htmlA.includes('missing_pk'), 'entity warning detail contains pk rule info');

// 6. Missing-target FK link rendered with dict-link-missing class
assert(htmlA.includes('dict-link-missing'), 'FK anchor to missing target has dict-link-missing class');

// 7. Missing-target FK link href points to #missing-Hat
assert(htmlA.includes('href="#missing-Hat"'), 'FK anchor href points to #missing-Hat');

// 8. #missing-Hat placeholder section present at page bottom
assert(htmlA.includes('id="missing-Hat"'), '#missing-Hat placeholder section exists');

// 9. Placeholder section has correct class
assert(htmlA.includes('class="dict-missing-section"'), 'placeholder section has dict-missing-section class');

// 10. Placeholder section label
assert(htmlA.includes('Hat (omitted)'), 'placeholder section heading says "Hat (omitted)"');

// --- Fixture B (clean — no findings) ---
const validationB = validateModel(modelB);
const htmlB = await generateDict(
  modelB,
  { globalErrors: validationB.globalErrors, entityErrors: validationB.entityErrors },
  'dark',
  {},
);

// 11. No banner when no global errors
assert(!htmlB.includes('<div class="dict-global-banner">'), 'no global banner when globalErrors is empty');

// 12. No warning triangle when no entity errors
assert(!htmlB.includes('class="dict-entity-warning"'), 'no entity warning triangle when entityErrors is empty');

// 13. No missing section when no dangling FK targets
assert(!htmlB.includes('class="dict-missing-section"'), 'no missing section when no dangling FK targets');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll dict-findings tests passed.');
}
