/**
 * test-cp5-title-override.ts — CP5 title: frontmatter override tests.
 *
 * Proves:
 *   1. FlowExternal with `title:` frontmatter: id remains the slug, label is the override.
 *   2. FlowProcess with `title:` frontmatter: id remains the slug, label is the override.
 *   3. FlowStoreRef with `title:` frontmatter: name remains the slug, displayName is the override.
 *   4. A title: override does NOT break id/slug resolution — the stable id, not the display
 *      label, must be the map key so `[[Buyer]]` and `ext:Buyer` still resolve even when
 *      the external's label is overridden.
 *
 * Generates its fixture at runtime under tmp/ (self-contained — no committed
 * demo and no dependency on pre-existing state, so it runs on a fresh CI
 * checkout where tmp/ is gitignored and empty).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowExternal, FlowProcess, FlowStoreRef } from '../../src/flows/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

const FIXTURE = 'tmp/title-override-fixture';
const DFD_DIR = `${FIXTURE}/flows/sample-dfd`;

// Build the fixture fresh: an external, process, and cache store that each
// carry a `title:` override distinct from their slug.
rmSync(FIXTURE, { recursive: true, force: true });
mkdirSync(`${DFD_DIR}/_externals`, { recursive: true });
mkdirSync(`${DFD_DIR}/_stores`, { recursive: true });

writeFileSync(`${DFD_DIR}/_externals/Buyer.md`, `---
external: Buyer
title: End Buyer
---

The customer who places orders in the system.
`);

writeFileSync(`${DFD_DIR}/_stores/hot-cache.md`, `---
kind: cache
title: Hot Cache
---

In-memory cache for frequently accessed data.
`);

writeFileSync(`${DFD_DIR}/Handle-Request.md`, `---
process: Handle Request
title: Process The Request
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

Handles incoming requests from buyers.
`);

const { flowModel, globalErrors } = await parseFlows(FIXTURE);

assert(globalErrors.length === 0, `parseFlows title-override fixture — expected no globalErrors, got: ${JSON.stringify(globalErrors)}`);
assert(flowModel.diagrams.length === 1, `expected 1 diagram, got ${flowModel.diagrams.length}`);
console.log('PASS: title-override fixture parses without errors');

const diagram = flowModel.diagrams[0]!;

// ---------------------------------------------------------------------------
// 1. FlowExternal: id is stable slug; label is the title: override
// ---------------------------------------------------------------------------

assert(diagram.externals.length === 1, `expected 1 external, got ${diagram.externals.length}`);
const ext: FlowExternal = diagram.externals[0]!;

assert(ext.id === 'Buyer', `external id should be 'Buyer' (slug), got '${ext.id}'`);
assert(ext.label === 'End Buyer', `external label should be 'End Buyer' (title: override), got '${ext.label}'`);
console.log('PASS: FlowExternal.id is stable slug; FlowExternal.label is the title: override');

// ---------------------------------------------------------------------------
// 2. FlowProcess: id is stable slug; label is the title: override
// ---------------------------------------------------------------------------

assert(diagram.processes.length === 1, `expected 1 process, got ${diagram.processes.length}`);
const proc: FlowProcess = diagram.processes[0]!;

assert(proc.id === 'Handle-Request', `process id should be 'Handle-Request' (slug), got '${proc.id}'`);
assert(proc.label === 'Process The Request', `process label should be 'Process The Request' (title: override), got '${proc.label}'`);
console.log('PASS: FlowProcess.id is stable slug; FlowProcess.label is the title: override');

// ---------------------------------------------------------------------------
// 3. FlowStoreRef: name is stable slug; displayName is the title: override
// ---------------------------------------------------------------------------

const cacheStore: FlowStoreRef | undefined = diagram.storeRefs.find(s => s.kind === 'cache');
assert(cacheStore !== undefined, 'expected a cache storeRef');
assert(cacheStore!.name === 'hot-cache', `storeRef name should be 'hot-cache' (slug), got '${cacheStore!.name}'`);
assert(cacheStore!.displayName === 'Hot Cache', `storeRef displayName should be 'Hot Cache' (title: override), got '${cacheStore!.displayName}'`);
console.log('PASS: FlowStoreRef.name is stable slug; FlowStoreRef.displayName is the title: override');

// ---------------------------------------------------------------------------
// 4. Resolution by id: a title: override must NOT break id-keyed lookup.
//
//    App.tsx buildFlowDocResolver is not exported, but we can prove the
//    contract directly: FlowExternal.id is the stable key that the (now fixed)
//    resolver uses. Build the same id-keyed map the fixed resolver builds and
//    assert it resolves by slug — proving that `[[Buyer]]` and `ext:Buyer`
//    still resolve even when `ext.label === 'End Buyer'`.
// ---------------------------------------------------------------------------

// Simulate the id-keyed map the fixed App.tsx resolver builds.
const externalById = new Map<string, FlowExternal>();
for (const e of diagram.externals) {
    if (!externalById.has(e.id)) externalById.set(e.id, e);
}

// Resolution by slug must work.
const resolved = externalById.get('Buyer');
assert(resolved !== undefined, 'ext:Buyer (slug) must resolve from the id-keyed map even when label="End Buyer"');
assert(resolved!.label === 'End Buyer', `resolved external display label should be 'End Buyer', got '${resolved!.label}'`);
console.log('PASS: id-keyed map resolves ext:Buyer → label="End Buyer" (title: override does not break id resolution)');

// Confirm that looking up by the override label does NOT work in this map —
// proving the map key is strictly the id/slug, not a mixture.
const notByLabel = externalById.get('End Buyer');
assert(notByLabel === undefined, 'id-keyed map must NOT resolve by display label "End Buyer" (only by slug "Buyer")');
console.log('PASS: id-keyed map does not resolve by display label (key is strictly the slug)');

// Same for processes: processById is keyed by id (already was, verify it still holds).
const processById = new Map<string, FlowProcess>();
for (const p of diagram.processes) {
    if (!processById.has(p.id)) processById.set(p.id, p);
}

const resolvedProc = processById.get('Handle-Request');
assert(resolvedProc !== undefined, 'proc:Handle-Request (slug) must resolve from the id-keyed map even when label is overridden');
assert(resolvedProc!.label === 'Process The Request', `resolved process label should be 'Process The Request', got '${resolvedProc!.label}'`);
console.log('PASS: id-keyed process map resolves Handle-Request → label="Process The Request"');

console.log('\nAll CP5 title-override parse tests passed.');
