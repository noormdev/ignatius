/**
 * test-description-field.ts — `description:` frontmatter across the five file kinds.
 *
 * Verifies SC4: a top-level `description:` string parses on entity, group,
 * flow-process, external, and store files and reaches the model; absence is
 * never an error.
 *
 * Generates its fixture at runtime under tmp/ (self-contained, no dependency
 * on pre-existing state).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { assert } from '../assert';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';

function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagramInTree(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const MODEL_FIXTURE = 'tmp/description-field-model-fixture';
const FLOW_FIXTURE = 'tmp/description-field-flow-fixture';

// --- entity + group model fixture ---

rmSync(MODEL_FIXTURE, { recursive: true, force: true });
mkdirSync(`${MODEL_FIXTURE}/data/identity`, { recursive: true });
mkdirSync(`${MODEL_FIXTURE}/groups`, { recursive: true });

writeFileSync(`${MODEL_FIXTURE}/groups/identity.md`, `---
label: Identity
color: "#4a90e2"
description: Entities that identify a person or account.
---

Group body text.
`);

writeFileSync(`${MODEL_FIXTURE}/data/identity/Widget.md`, `---
entity: Widget
description: A thing the system tracks.
pk: [id]
columns:
  id: { type: uuid }
---
`);

writeFileSync(`${MODEL_FIXTURE}/data/identity/Plain.md`, `---
entity: Plain
pk: [id]
columns:
  id: { type: uuid }
---
`);

{
  const { model, globalErrors } = await parseModels(MODEL_FIXTURE);

  assert(globalErrors.length === 0, `FAIL: expected no global errors, got ${JSON.stringify(globalErrors)}`);

  const widget = model.nodes.find(n => n.id === 'Widget');
  assert(widget?.description === 'A thing the system tracks.', `FAIL: Widget.description = ${JSON.stringify(widget?.description)}`);
  console.log('PASS: entity description: reaches ModelNode.description');

  const plain = model.nodes.find(n => n.id === 'Plain');
  assert(plain !== undefined && plain.description === undefined, `FAIL: Plain.description should be undefined, got ${JSON.stringify(plain?.description)}`);
  console.log('PASS: entity with no description: parses clean, description is undefined');

  const identityGroup = model.groups['identity'];
  assert(identityGroup?.description === 'Entities that identify a person or account.', `FAIL: groups.identity.description = ${JSON.stringify(identityGroup?.description)}`);
  console.log('PASS: group description: reaches GroupConfig.description');
}

// --- flow-process, external, store fixture ---

rmSync(FLOW_FIXTURE, { recursive: true, force: true });
mkdirSync(`${FLOW_FIXTURE}/flows/sample-dfd`, { recursive: true });
mkdirSync(`${FLOW_FIXTURE}/externals`, { recursive: true });
mkdirSync(`${FLOW_FIXTURE}/stores`, { recursive: true });

writeFileSync(`${FLOW_FIXTURE}/externals/Buyer.md`, `---
external: Buyer
description: A customer who places orders.
---

Buyer body.
`);

writeFileSync(`${FLOW_FIXTURE}/externals/Unreferenced.md`, `---
external: Unreferenced
description: Declared but never used by any flow edge.
---

Unreferenced body.
`);

writeFileSync(`${FLOW_FIXTURE}/stores/hot-cache.md`, `---
kind: cache
description: In-memory cache for frequently accessed data.
---

Cache body.
`);

writeFileSync(`${FLOW_FIXTURE}/flows/sample-dfd/Handle-Request.md`, `---
process: Handle Request
description: Validates and stores an incoming request.
number: 1
inputs:
  - from: ext:Buyer
    data: request data
  - from: cache:hot-cache
    data: cached item
outputs:
  - to: ext:Buyer
    data: response
---

Process body.
`);

{
  const { flowModel, globalErrors } = await parseFlows(FLOW_FIXTURE);

  assert(globalErrors.length === 0, `FAIL: expected no global errors, got ${JSON.stringify(globalErrors)}`);

  const diagram = findDiagramInTree(flowModel.diagrams, 'sample-dfd');
  assert(diagram !== undefined, `FAIL: diagram 'sample-dfd' not found`);

  const proc = diagram!.processes[0];
  assert(proc?.description === 'Validates and stores an incoming request.', `FAIL: process.description = ${JSON.stringify(proc?.description)}`);
  console.log('PASS: flow-process description: reaches FlowProcess.description');

  const ext = diagram!.externals[0];
  assert(ext?.description === 'A customer who places orders.', `FAIL: external.description = ${JSON.stringify(ext?.description)}`);
  console.log('PASS: external description: reaches FlowExternal.description');

  const store = diagram!.storeRefs.find(s => s.kind === 'cache');
  assert(store?.description === 'In-memory cache for frequently accessed data.', `FAIL: store.description = ${JSON.stringify(store?.description)}`);
  console.log('PASS: store description: reaches FlowStoreRef.description');

  const unreferenced = flowModel.externals.find(e => e.id === 'Unreferenced');
  assert(
    unreferenced?.description === 'Declared but never used by any flow edge.',
    `FAIL: unreferenced external's description = ${JSON.stringify(unreferenced?.description)}`,
  );
  console.log('PASS: unreferenced external description: reaches root FlowModel.externals');
}

console.log('\nAll description-field tests passed.');
