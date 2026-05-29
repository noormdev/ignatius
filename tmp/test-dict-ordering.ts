/**
 * Tests CP-1: group sort_key ordering + entity hierarchy ordering in dict.
 *
 * Hierarchy rule (within a group):
 *   1. Independent basetype-clusters first (basetype classification is kernel/independent).
 *   2. Dependent basetype-clusters second.
 *   3. Within a tier, clusters sorted alphabetically by basetype id.
 *   4. Within a cluster: basetype first, then subtypes alphabetical.
 *   5. Standalones treated as a basetype-cluster of one; tier = their classification tier.
 *   6. Orphan subtype (members[] ref but basetype missing from nodes): treated as
 *      basetype-cluster-of-one in the dependent tier.
 *
 * Group order rule:
 *   sort_key numeric ascending, then unsorted groups alphabetical by id.
 *   Collision on same sort_key: stable secondary sort by group id.
 *
 * sort_key parse violation:
 *   non-numeric sort_key in frontmatter throws with the group name.
 */

import { generateDict } from '../src/generators/dict';
import type { Model, GroupConfig, ModelNode, ModelEdge, SubtypeCluster, ThemeConfig, Branding } from '../src/parse';
import { defaultTheme } from '../src/theme-defaults';
import { defaultBranding } from '../src/branding-defaults';

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function assertOrder(html: string, ids: string[], msg: string) {
  const positions = ids.map(id => html.indexOf(`id="entity-${id}"`));
  let ok = true;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i - 1] === -1 || positions[i] === -1 || positions[i - 1] >= positions[i]) {
      ok = false;
      console.error(`FAIL: ${msg} — order broken at index ${i}: "${ids[i - 1]}"(${positions[i - 1]}) should precede "${ids[i]}"(${positions[i]})`);
      failures++;
      return;
    }
  }
  if (ok) console.log(`PASS: ${msg}`);
}

function makeNode(id: string, classification: string, group: string): ModelNode {
  return {
    id,
    classification,
    group,
    pk: [`${id.toLowerCase()}_id`],
    columns: { [`${id.toLowerCase()}_id`]: { type: 'integer' } },
    alternateKeys: [],
    bodyHtml: '',
  };
}

function makeTheme(): ThemeConfig {
  return defaultTheme;
}

function makeBranding(): Branding {
  return defaultBranding;
}

// ─── Test 1: hierarchy ordering in identity group ─────────────────────────────
// Expected: Party, Business, Person (independent cluster), Identity, ITIN, License, Passport, SSN (dependent cluster)

const identityModel: Model = {
  groups: {
    identity: { label: 'Identity', color: '#2ea043' } as GroupConfig,
  },
  nodes: [
    // Listed in alphabetical order intentionally — ordering must NOT be alphabetical
    makeNode('Business', 'Subtype', 'identity'),
    makeNode('Identity', 'Dependent', 'identity'),
    makeNode('ITIN', 'Subtype', 'identity'),
    makeNode('License', 'Subtype', 'identity'),
    makeNode('Party', 'Independent', 'identity'),
    makeNode('Passport', 'Subtype', 'identity'),
    makeNode('Person', 'Subtype', 'identity'),
    makeNode('SSN', 'Subtype', 'identity'),
  ],
  edges: [] as ModelEdge[],
  subtypeClusters: [
    { basetype: 'Party', exclusive: true, members: ['Business', 'Person'] } as SubtypeCluster,
    { basetype: 'Identity', exclusive: false, members: ['ITIN', 'License', 'Passport', 'SSN'] } as SubtypeCluster,
  ],
  theme: makeTheme(),
  branding: makeBranding(),
};

const identityHtml = await generateDict(identityModel, 'dark');

assertOrder(
  identityHtml,
  ['Party', 'Business', 'Person', 'Identity', 'ITIN', 'License', 'Passport', 'SSN'],
  'identity group renders in hierarchy order: Party→Business→Person, Identity→ITIN→License→Passport→SSN',
);

// ─── Test 2: group sort_key ordering ─────────────────────────────────────────
// Group "a" has sort_key:2, group "b" has sort_key:1, group "c" has no sort_key
// Expected render order: b (sort_key:1), a (sort_key:2), c (alphabetical after sorted)

const sortKeyModel: Model = {
  groups: {
    a: { label: 'Group A', color: '#ff0000', sort_key: 2 } as GroupConfig,
    b: { label: 'Group B', color: '#00ff00', sort_key: 1 } as GroupConfig,
    c: { label: 'Group C', color: '#0000ff' } as GroupConfig,
  },
  nodes: [
    makeNode('EntityA', 'Kernel', 'a'),
    makeNode('EntityB', 'Kernel', 'b'),
    makeNode('EntityC', 'Kernel', 'c'),
  ],
  edges: [],
  subtypeClusters: [],
  theme: makeTheme(),
  branding: makeBranding(),
};

const sortKeyHtml = await generateDict(sortKeyModel, 'dark');

assertOrder(
  sortKeyHtml,
  ['EntityB', 'EntityA', 'EntityC'],
  'groups render in sort_key order: b(1) → a(2) → c(unsorted)',
);

// ─── Test 3: sort_key collision secondary sort by group id ────────────────────

const collisionModel: Model = {
  groups: {
    beta: { label: 'Beta', color: '#ff0000', sort_key: 1 } as GroupConfig,
    alpha: { label: 'Alpha', color: '#00ff00', sort_key: 1 } as GroupConfig,
  },
  nodes: [
    makeNode('Beta_entity', 'Kernel', 'beta'),
    makeNode('Alpha_entity', 'Kernel', 'alpha'),
  ],
  edges: [],
  subtypeClusters: [],
  theme: makeTheme(),
  branding: makeBranding(),
};

const collisionHtml = await generateDict(collisionModel, 'dark');

assertOrder(
  collisionHtml,
  ['Alpha_entity', 'Beta_entity'],
  'sort_key collision: secondary sort by group id alphabetical (alpha before beta)',
);

// ─── Test 4: unsorted groups after sorted, alphabetical by id ─────────────────

const unsortedModel: Model = {
  groups: {
    zebra: { label: 'Zebra', color: '#ff0000' } as GroupConfig,
    apple: { label: 'Apple', color: '#00ff00' } as GroupConfig,
    sorted: { label: 'Sorted', color: '#0000ff', sort_key: 1 } as GroupConfig,
  },
  nodes: [
    makeNode('Zebra_entity', 'Kernel', 'zebra'),
    makeNode('Apple_entity', 'Kernel', 'apple'),
    makeNode('Sorted_entity', 'Kernel', 'sorted'),
  ],
  edges: [],
  subtypeClusters: [],
  theme: makeTheme(),
  branding: makeBranding(),
};

const unsortedHtml = await generateDict(unsortedModel, 'dark');

assertOrder(
  unsortedHtml,
  ['Sorted_entity', 'Apple_entity', 'Zebra_entity'],
  'sorted groups before unsorted, unsorted alphabetical by id: sorted(1) → apple → zebra',
);

// ─── Test 5: standalone nodes (neither basetype nor subtype) ─────────────────
// Two standalones: Bravo (Kernel) and Alpha (Dependent). Expected: Alpha independent? No.
// Standalones classified by their own classification: independent (Kernel) first, then dependent.
// Alpha is Dependent, Bravo is Kernel → Bravo first (independent tier), Alpha second (dependent tier).

const standaloneModel: Model = {
  groups: {
    group1: { label: 'Group1', color: '#ff0000' } as GroupConfig,
  },
  nodes: [
    makeNode('Alpha', 'Dependent', 'group1'),
    makeNode('Bravo', 'Kernel', 'group1'),
  ],
  edges: [],
  subtypeClusters: [],
  theme: makeTheme(),
  branding: makeBranding(),
};

const standaloneHtml = await generateDict(standaloneModel, 'dark');

assertOrder(
  standaloneHtml,
  ['Bravo', 'Alpha'],
  'standalone: Bravo(Kernel=independent) before Alpha(Dependent)',
);

// ─── Test 6: parse violation test ────────────────────────────────────────────
// parseModels on a group with sort_key: "abc" should throw with the group name.
// We can't call parseModels without the filesystem, so we verify the parse guard
// via a direct import and simulate the frontmatter parsing path.

import { parseModels } from '../src/parse';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = await mkdtemp(join(tmpdir(), 'dict-ordering-test-'));
try {
  // Create minimal valid structure
  await Bun.write(join(dir, '_groups', 'badgroup.md'), `---\nlabel: Bad\ncolor: "#ff0000"\nsort_key: "abc"\n---\n`);
  // Need at least one entity file to avoid empty parse
  await Bun.write(join(dir, 'Entity.md'), `---\nentity: Entity\nclassification: Kernel\ngroup: badgroup\npk:\n  - id\ncolumns:\n  id:\n    type: integer\n---\n`);

  let threw = false;
  let errorMsg = '';
  try {
    await parseModels(dir);
  } catch (e) {
    threw = true;
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  assert(threw, 'parseModels throws when sort_key is non-numeric string');
  assert(
    errorMsg.includes('badgroup'),
    `error message includes group name "badgroup" (got: "${errorMsg}")`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ─── Summary ──────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll dict-ordering assertions passed.');
}
