/**
 * test-folder-model.ts — verifies the new data/ + groups/ folder model contract.
 *
 * Assertions (from a caller's perspective, using a temp model under tmp/):
 *   1. An entity .md placed under data/ IS parsed.
 *   2. An entity .md placed OUTSIDE data/ (at the model root, in a notes/ dir) is NOT parsed.
 *   3. A model with NO groups/ directory parses cleanly: zero groups, no throw, no global error.
 *   4. A model WITH groups/<slug>.md resolves the group for an entity whose frontmatter matches.
 */

import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { rmSync, mkdirSync } from 'node:fs';

const TMP = 'tmp/test-folder-model';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Build a clean fixture dir
if (import.meta.dir) {
  // run from any cwd; tmp/ is relative to project root
}
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// ---------------------------------------------------------------------------
// Test 1 + 2: entity under data/ IS parsed; entity at root or in notes/ is NOT
// ---------------------------------------------------------------------------

{
  const dir = `${TMP}/scan-confinement`;
  mkdirSync(`${dir}/data`, { recursive: true });
  mkdirSync(`${dir}/notes`, { recursive: true });

  await Bun.write(`${dir}/ignatius.yml`, 'name: scan-confinement\n');

  // Entity inside data/ — must be discovered
  await Bun.write(`${dir}/data/Inside.md`, `---
entity: Inside
pk: [id]
columns:
  id: { type: uuid }
---
`);

  // Entity at model root — must NOT be discovered
  await Bun.write(`${dir}/OutsideRoot.md`, `---
entity: OutsideRoot
pk: [id]
columns:
  id: { type: uuid }
---
`);

  // Entity in a free-form notes/ dir — must NOT be discovered
  await Bun.write(`${dir}/notes/OutsideNotes.md`, `---
entity: OutsideNotes
pk: [id]
columns:
  id: { type: uuid }
---
`);

  const { model, globalErrors } = await parseModels(dir);

  assert(globalErrors.length === 0, `Test 1/2: expected 0 global errors, got ${globalErrors.length}: ${JSON.stringify(globalErrors)}`);
  assert(model.nodes.length === 1, `Test 1/2: expected exactly 1 node (Inside), got ${model.nodes.length}: ${model.nodes.map(n => n.id).join(', ')}`);
  assert(model.nodes[0]!.id === 'Inside', `Test 1/2: expected node 'Inside', got '${model.nodes[0]?.id}'`);

  console.log('PASS: entity under data/ is parsed; entities outside data/ are not');
}

// ---------------------------------------------------------------------------
// Test 3: model with NO groups/ directory parses cleanly — zero groups, no throw
// ---------------------------------------------------------------------------

{
  const dir = `${TMP}/no-groups`;
  mkdirSync(`${dir}/data`, { recursive: true });
  // no groups/ dir created

  await Bun.write(`${dir}/ignatius.yml`, 'name: no-groups\n');
  await Bun.write(`${dir}/data/Entity.md`, `---
entity: Entity
pk: [id]
columns:
  id: { type: uuid }
---
`);

  let threw = false;
  let result: Awaited<ReturnType<typeof parseModels>> | undefined;
  try {
    result = await parseModels(dir);
  } catch (e) {
    threw = true;
    console.error('FAIL: parseModels threw on missing groups/ dir:', e);
    process.exit(1);
  }

  assert(!threw, 'Test 3: parseModels should not throw when groups/ is absent');
  assert(result !== undefined, 'Test 3: result should not be undefined');
  assert(Object.keys(result.model.groups).length === 0, `Test 3: expected 0 groups, got ${Object.keys(result.model.groups).length}`);
  assert(result.globalErrors.length === 0, `Test 3: expected 0 global errors, got ${result.globalErrors.length}`);
  assert(result.model.nodes.length === 1, `Test 3: expected 1 node, got ${result.model.nodes.length}`);

  console.log('PASS: model with no groups/ directory parses cleanly with zero groups');
}

// ---------------------------------------------------------------------------
// Test 4: model WITH groups/<slug>.md resolves the group for a matching entity
// ---------------------------------------------------------------------------

{
  const dir = `${TMP}/with-groups`;
  mkdirSync(`${dir}/data`, { recursive: true });
  mkdirSync(`${dir}/groups`, { recursive: true });

  await Bun.write(`${dir}/ignatius.yml`, 'name: with-groups\n');
  await Bun.write(`${dir}/groups/core.md`, `---
label: Core Domain
color: "#4f86c6"
---
`);
  await Bun.write(`${dir}/data/Customer.md`, `---
entity: Customer
group: core
pk: [customer_id]
columns:
  customer_id: { type: uuid }
---
`);

  const { model, globalErrors } = await parseModels(dir);

  assert(globalErrors.length === 0, `Test 4: expected 0 global errors, got ${globalErrors.length}: ${JSON.stringify(globalErrors)}`);
  assert(model.nodes.length === 1, `Test 4: expected 1 node, got ${model.nodes.length}`);
  assert(model.nodes[0]!.id === 'Customer', `Test 4: expected node 'Customer', got '${model.nodes[0]?.id}'`);
  assert(Object.keys(model.groups).length === 1, `Test 4: expected 1 group, got ${Object.keys(model.groups).length}`);
  assert('core' in model.groups, `Test 4: expected group 'core', got keys: ${Object.keys(model.groups).join(', ')}`);
  assert(model.groups['core']!.label === 'Core Domain', `Test 4: expected label 'Core Domain', got '${model.groups['core']?.label}'`);
  assert(model.nodes[0]!.group === 'core', `Test 4: entity group should be 'core', got '${model.nodes[0]?.group}'`);

  console.log('PASS: model with groups/ resolves group config for a matching entity');
}

// ---------------------------------------------------------------------------
// Test 5 (CP2): parseFlows reads root externals/ and root stores/; ignores _externals placed under a DFD folder
// ---------------------------------------------------------------------------

{
  const dir = `${TMP}/flow-registries`;
  mkdirSync(`${dir}/flows/checkout`, { recursive: true });
  mkdirSync(`${dir}/externals`, { recursive: true });
  mkdirSync(`${dir}/stores`, { recursive: true });
  // Intentionally place a _externals/ dir UNDER the DFD — parser must NOT read it.
  mkdirSync(`${dir}/flows/checkout/_externals`, { recursive: true });

  await Bun.write(`${dir}/ignatius.yml`, 'name: flow-registries\n');

  // Root-level external — must be resolved
  await Bun.write(`${dir}/externals/Customer.md`, `---
external: Customer
---

A real customer.
`);

  // Root-level store — must be resolved with display name override
  await Bun.write(`${dir}/stores/session-cache.md`, `---
kind: cache
title: Session Cache
---

Active sessions.
`);

  // Per-DFD _externals/ entry — must NOT be read
  await Bun.write(`${dir}/flows/checkout/_externals/Phantom.md`, `---
external: Phantom
---

Should not be visible.
`);

  // A process referencing both the root external and a non-existent phantom
  await Bun.write(`${dir}/flows/checkout/Process-Order.md`, `---
process: Process Order
number: 1
inputs:
  - from: ext:Customer
    data: order
outputs:
  - to: cache:session-cache
    data: session_id
---
`);

  const { flowModel, globalErrors } = await parseFlows(dir);

  assert(globalErrors.length === 0, `Test 5: expected 0 globalErrors from parseFlows, got ${globalErrors.length}: ${JSON.stringify(globalErrors)}`);

  // Find the 'checkout' diagram inside the leveled tree
  function findDiagram(diagrams: typeof flowModel.diagrams, id: string): (typeof flowModel.diagrams)[0] | undefined {
    for (const d of diagrams) {
      if (d.id === id) return d;
      const found = findDiagram(d.subDfds, id);
      if (found) return found;
    }
    return undefined;
  }

  const checkoutDiagram = findDiagram(flowModel.diagrams, 'checkout');
  assert(checkoutDiagram !== undefined, 'Test 5: checkout diagram not found in leveled tree');

  // Root external Customer must be resolved
  const customerExt = checkoutDiagram!.externals.find(e => e.id === 'Customer');
  assert(customerExt !== undefined, 'Test 5: ext:Customer (from root externals/) should be resolved');

  // Phantom must NOT appear (per-DFD _externals/ not read)
  const phantomExt = checkoutDiagram!.externals.find(e => e.id === 'Phantom');
  assert(phantomExt === undefined, 'Test 5: ext:Phantom (from per-DFD _externals/) must NOT be resolved — parser reads only root externals/');

  // Root store session-cache must carry the title: override
  const sessionStore = checkoutDiagram!.storeRefs.find(s => s.kind === 'cache' && s.name === 'session-cache');
  assert(sessionStore !== undefined, 'Test 5: cache:session-cache (from root stores/) should be present in storeRefs');
  assert(sessionStore!.displayName === 'Session Cache', `Test 5: displayName should be 'Session Cache' (title: override), got '${sessionStore!.displayName}'`);

  console.log('PASS: parseFlows reads root externals/ and stores/; ignores per-DFD _externals/ dir');
}

console.log('\nAll folder-model tests passed.');
