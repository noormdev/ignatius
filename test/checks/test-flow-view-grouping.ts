/**
 * test-flow-view-grouping.ts — the per-process (default) view's stacking in
 * flow-layout.ts / elk-flow-layout.ts / model/parse.ts's flow_view: block.
 *
 * Covers:
 *  - buildFlowData(diagram) with no opts stays byte-for-byte today's output
 *    (no stack nodes) on hub-diagram
 *  - ignatius.yml's flow_view: { adjacency_stacks: true } parses into
 *    model._meta.flowView.adjacencyStacks; absent parses to undefined (on)
 *  - per-process stack ids and node/edge sharing on hub-diagram: P3 and P8
 *    converge on the same read stack; every other process gets its own
 *    distinct read stack; P3's write side stacks the adjacency pair; P4-P7's
 *    single-store writes stay plain nodes
 *  - hub duplicate markers, memberEdges, and chip-line resolution (authored
 *    labels one per line; unauthored falls back to a column-preview line
 *    under the existing gate; a mixed stack shows authored labels then one
 *    gated column-preview line covering every unlabelled member's
 *    deduplicated columns, via the exact chipLines array)
 *  - the hub-diagram count criteria: 13 rendered store-side edges, 12
 *    distinct store-side nodes
 *  - ELK sizing (row-count height, widest-member width) and band assignment
 *    (read stack → band 1, write stack → band 3) with no node overlap
 *  - layoutFlowFingerprint(hub-diagram) is unaffected by calling
 *    buildFlowData with per-process opts
 *  - elk.separateConnectedComponents is scoped to the per-process view only:
 *    absent from the default graph's layoutOptions (today's layout is
 *    provably untouched), present when view is 'per-process'
 *  - a store that is a stack member for one process and the sole same-band
 *    store for another process is marked duplicated in both places
 *  - connected view: the explicit cluster: tag, author cluster, subtype
 *    family, group, and adjacency grouping passes on hub-diagram; collapse
 *    level applied to a stack's rows (stores/clusters/groups); adjacency_stacks:
 *    false leaves the adjacency pairs as plain nodes
 *  - models/llm-memory-db-mssql: Merge Tag's cluster:tag-junctions rewrite
 *    groups under cluster:tag-junctions--write with the "Tag junctions" chip,
 *    and layoutFlowFingerprint(tag-administration) is unchanged by the rewrite
 *  - models/key-inherited: Validate-Customer's Party/Person/Business reads
 *    group under subtype:Party--read, labelled "Party"
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, must } from '../assert';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram, FlowEdge } from '../../src/flows/flow-parse';
import { buildFlowData, resolveChipLines, STORE_ROW_H, STORE_CAP_W, storeBodyWidth, layoutKeyForView } from '../../src/flow-view/flow-layout';
import type { FlowElementData, StoreNodeData } from '../../src/flow-view/flow-layout';
import { computeElkLayout, bandOf, nodeSize, buildElkGraph } from '../../src/flow-view/elk-flow-layout';
import type { ElkLayoutResult } from '../../src/flow-view/elk-flow-layout';
import { layoutFlowFingerprint } from '../../src/flows/flow-fingerprint';

const ROOT = resolve(import.meta.dir, '../..');
const HUB_DFD = `${ROOT}/test/fixtures/hub-dfd`;
const FLOWS_MODEL = `${ROOT}/test/fixtures/flows-model`;
const LLM_MEMORY_DB = `${ROOT}/models/llm-memory-db-mssql`;
const KEY_INHERITED = `${ROOT}/models/key-inherited`;

const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const workerFactory = () => new Worker(workerPath);

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

type StackNode = Extract<FlowElementData, { kind: 'node'; nodeType: 'stack' }>;
const isStack = (n: FlowElementData): n is StackNode => n.kind === 'node' && n.nodeType === 'stack';
const isStoreSide = (id: string) => id.startsWith('db:') || id.startsWith('stack:');

// ---------------------------------------------------------------------------
// 1. Config parse: flow_view: { adjacency_stacks: true } → _meta.flowView
// ---------------------------------------------------------------------------

{
  const { model } = await parseModels(HUB_DFD);
  assert(model._meta?.flowView?.adjacencyStacks === true, 'FAIL: hub-dfd should parse flow_view.adjacency_stacks: true');
  console.log('PASS: ignatius.yml flow_view: { adjacency_stacks: true } parses into model._meta.flowView.adjacencyStacks');

  const { model: noFlowView } = await parseModels(FLOWS_MODEL);
  assert(noFlowView._meta?.flowView === undefined, 'FAIL: a model with no flow_view: block should parse flowView as undefined (absent means on)');
  console.log('PASS: a model with no flow_view: block parses _meta.flowView as undefined');
}

// ---------------------------------------------------------------------------
// 2. buildFlowData(diagram) with no opts: unchanged today's output
// ---------------------------------------------------------------------------

const { flowModel } = await parseFlows(HUB_DFD);
const hub = findDiagram(flowModel.diagrams, 'hub-diagram');
assert(hub !== undefined, 'FAIL: hub-diagram not found in parsed hub-dfd model');
const diagram = hub!;

const { model: hubModel } = await parseModels(HUB_DFD);
const hubEntityGroups: Record<string, string> = {};
for (const node of hubModel.nodes) if (node.group) hubEntityGroups[node.id] = node.group;

{
  const defaultData = buildFlowData(diagram);
  assert(!defaultData.nodes.some(isStack), 'FAIL: buildFlowData(diagram) with no opts must emit no stack nodes');
  console.log('PASS: buildFlowData(diagram) with no opts emits no stack nodes (today\'s output unchanged)');
}

// ---------------------------------------------------------------------------
// 3. Per-process stacks: ids, sharing, counts
// ---------------------------------------------------------------------------

const perProcess = buildFlowData(diagram, { view: 'per-process' });

const stackNodes = perProcess.nodes.filter(isStack);
const readStacks = stackNodes.filter(n => n.direction === 'read');
const writeStacks = stackNodes.filter(n => n.direction === 'write');

assert(readStacks.length === 7, `FAIL: expected 7 distinct read stacks (P1, P2, {P3,P8} shared, P4, P5, P6, P7), got ${readStacks.length}`);
assert(writeStacks.length === 1, `FAIL: expected 1 write stack (P3's adjacency pair), got ${writeStacks.length}`);

const hubStackId = readStacks.find(n => n.members!.every(m => m.storeId === 'db:HubStoreA' || m.storeId === 'db:HubStoreB'))?.id;
assert(hubStackId !== undefined, 'FAIL: no read stack contains exactly {HubStoreA, HubStoreB}');
console.log(`PASS: P3/P8 shared hub-only read stack id = ${hubStackId}`);

const storeSideNodes = perProcess.nodes.filter(n => n.kind === 'node' && isStoreSide(n.id));
assert(storeSideNodes.length === 12, `FAIL: expected 12 distinct store-side nodes, got ${storeSideNodes.length}`);
console.log(`PASS: 12 distinct store-side nodes (${readStacks.length} read stacks + plain writes + 1 write stack)`);

const storeSideEdges = perProcess.edges.filter(e => e.kind === 'edge' && (isStoreSide(e.source) || isStoreSide(e.target)));
assert(storeSideEdges.length === 13, `FAIL: expected 13 rendered store-side edges, got ${storeSideEdges.length}`);
console.log('PASS: 13 rendered store-side edges on hub-diagram');

// P4-P7's single-store writes stay plain nodes, not stacks.
const plainWriteIds = ['db:PrivateStore4Write', 'db:PrivateStore5Write', 'db:PrivateStore6Write', 'db:PrivateStore7Write'];
for (const id of plainWriteIds) {
  const node = perProcess.nodes.find(n => n.id === id);
  assert(node !== undefined && node.nodeType === 'store', `FAIL: ${id} should render as a plain store node (below the stacking threshold)`);
}
console.log('PASS: P4-P7 single-store writes stay plain store nodes');

// ---------------------------------------------------------------------------
// 4. Duplicate markers on hub stores
// ---------------------------------------------------------------------------

for (const stack of readStacks) {
  for (const member of stack.members!) {
    const shouldBeDuplicated = member.storeId === 'db:HubStoreA' || member.storeId === 'db:HubStoreB';
    assert(
      member.duplicated === shouldBeDuplicated,
      `FAIL: ${member.storeId} in ${stack.id}: expected duplicated=${shouldBeDuplicated}, got ${member.duplicated}`,
    );
  }
}
console.log('PASS: HubStoreA/HubStoreB carry the duplicate marker in every read stack; other members do not');

// ---------------------------------------------------------------------------
// 5. memberEdges + chip lines on the P3 adjacency write stack
// ---------------------------------------------------------------------------

const adjacencyStack = writeStacks[0]!;
assert(
  adjacencyStack.members!.map(m => m.storeId).sort().join(',') === 'db:LogStoreOne,db:LogStoreTwo',
  `FAIL: expected the write stack to be {LogStoreOne, LogStoreTwo}, got ${adjacencyStack.members!.map(m => m.storeId).join(',')}`,
);
const adjacencyEdge = must(
  perProcess.edges.find(e => e.source === adjacencyStack.id || e.target === adjacencyStack.id),
  'a rendered edge into/out of the adjacency write stack',
);
const memberEdges: FlowEdge[] = adjacencyEdge.memberEdges ?? [];
assert(memberEdges.length === 2, `FAIL: adjacency stack edge should aggregate 2 memberEdges, got ${memberEdges.length}`);
// Every hub-dfd entry authors a label: (docs/spec/dfd-store-clusters.md SC1);
// both of Process Three's writes share "log entry", which collapses to one line.
assert(adjacencyEdge.hasAuthoredLabel === true, 'FAIL: hub-dfd authors label: on every entry — hasAuthoredLabel should be true');
assert(adjacencyEdge.label === 'log entry', `FAIL: expected the shared authored label "log entry", got "${adjacencyEdge.label}"`);
console.log('PASS: adjacency write stack edge carries 2 memberEdges and the shared authored label, collapsed to one line');

// Authored-label case, on a hand-built two-member stack: chip lines are the
// members' authored labels one per line, never truncated.
{
  const authoredEdges: FlowEdge[] = [
    { from: { kind: 'db', name: 'Alpha', raw: 'db:Alpha' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['x'], flowId: 'f', label: 'alpha flow' },
    { from: { kind: 'db', name: 'Beta', raw: 'db:Beta' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['y'], flowId: 'f', label: 'beta flow' },
  ];
  const synthetic: FlowDiagram = {
    id: 'synthetic', title: 'Synthetic',
    processes: [{ id: 'p', label: 'P', dottedNumber: '1', inputs: authoredEdges, outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' }],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'Alpha', displayName: 'Alpha', flowId: 'f' },
      { kind: 'db', name: 'Beta', displayName: 'Beta', flowId: 'f' },
    ],
    edges: authoredEdges,
    subDfds: [],
  };
  const { edges } = buildFlowData(synthetic, { view: 'per-process' });
  const stackEdge = must(edges.find(e => e.source.startsWith('stack:')), 'the synthetic stack edge');
  assert(stackEdge.hasAuthoredLabel === true, 'FAIL: a stack whose members all carry label: should mark hasAuthoredLabel true');
  assert(stackEdge.label === 'alpha flow, beta flow', `FAIL: expected authored labels joined, got "${stackEdge.label}"`);
  const { lines, hasHiddenLabel } = resolveChipLines(stackEdge.label, stackEdge.hasAuthoredLabel);
  assert(lines.join('|') === 'alpha flow|beta flow', `FAIL: expected one chip line per authored label, got ${JSON.stringify(lines)}`);
  assert(hasHiddenLabel === false, 'FAIL: an authored stack chip is never truncated/hidden');
  console.log('PASS: a stack whose members all carry an authored label: renders one chip line per label, never truncated');
}

// Unauthored fallback, on a hand-built two-member stack whose members carry
// no label: at all: the chip is the deduplicated union of their columns, not
// their display names (which would merely repeat what the stack's own rows
// already show).
{
  const unauthoredEdges: FlowEdge[] = [
    { from: { kind: 'db', name: 'Gamma', raw: 'db:Gamma' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['shared_id', 'gamma_only'], flowId: 'f' },
    { from: { kind: 'db', name: 'Delta', raw: 'db:Delta' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['shared_id', 'delta_only'], flowId: 'f' },
  ];
  const synthetic: FlowDiagram = {
    id: 'synthetic-unauthored', title: 'Synthetic',
    processes: [{ id: 'p', label: 'P', dottedNumber: '1', inputs: unauthoredEdges, outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' }],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'Gamma', displayName: 'Gamma', flowId: 'f' },
      { kind: 'db', name: 'Delta', displayName: 'Delta', flowId: 'f' },
    ],
    edges: unauthoredEdges,
    subDfds: [],
  };
  const { edges } = buildFlowData(synthetic, { view: 'per-process' });
  const stackEdge = must(edges.find(e => e.source.startsWith('stack:')), 'the synthetic stack edge');
  assert(stackEdge.hasAuthoredLabel === false, 'FAIL: no member carries label: — hasAuthoredLabel should be false');
  // Member order follows the stack's sorted member ids (Delta before Gamma),
  // not authoring order.
  assert(
    stackEdge.label === 'shared_id, delta_only, gamma_only',
    `FAIL: expected the deduplicated column union, got "${stackEdge.label}"`,
  );
  assert(!stackEdge.label.includes('Gamma') && !stackEdge.label.includes('Delta'), 'FAIL: fallback must not be the members’ display names');
  console.log('PASS: an unauthored stack chip falls back to the deduplicated column union, not member names');
}

// Mixed labelled/unlabelled members, on a hand-built three-member stack with
// TWO unlabelled members (one carrying 2+ columns): the chip shows the
// authored labels first, then ONE column-preview line covering every
// unlabelled member — the deduplicated union of their columns, not one line
// per member (which would fragment "tag_id, memory_id" into indistinguishable
// per-column lines once resolveChipLines re-splits on ", ").
{
  const mixedEdges: FlowEdge[] = [
    { from: { kind: 'db', name: 'Epsilon', raw: 'db:Epsilon' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['tag_id', 'x_id'], flowId: 'f', label: 'Tag junctions' },
    { from: { kind: 'db', name: 'Zeta', raw: 'db:Zeta' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['tag_id', 'memory_id'], flowId: 'f' },
    { from: { kind: 'db', name: 'Eta', raw: 'db:Eta' }, to: { kind: 'proc', name: 'p', raw: 'proc:p' }, data: ['tag_id'], flowId: 'f' },
  ];
  const synthetic: FlowDiagram = {
    id: 'synthetic-mixed', title: 'Synthetic',
    processes: [{ id: 'p', label: 'P', dottedNumber: '1', inputs: mixedEdges, outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' }],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'Epsilon', displayName: 'Epsilon', flowId: 'f' },
      { kind: 'db', name: 'Zeta', displayName: 'Zeta', flowId: 'f' },
      { kind: 'db', name: 'Eta', displayName: 'Eta', flowId: 'f' },
    ],
    edges: mixedEdges,
    subDfds: [],
  };
  const { edges } = buildFlowData(synthetic, { view: 'per-process' });
  const stackEdge = must(edges.find(e => e.source.startsWith('stack:')), 'the synthetic stack edge');
  assert(stackEdge.hasAuthoredLabel === true, 'FAIL: at least one member carries label: — hasAuthoredLabel should be true');
  assert(
    JSON.stringify(stackEdge.chipLines) === JSON.stringify(['Tag junctions', 'tag_id, memory_id']),
    `FAIL: expected the authored label then one deduplicated column-preview line covering both unlabelled members, got ${JSON.stringify(stackEdge.chipLines)}`,
  );
  console.log('PASS: a mixed stack shows the authored labels then one deduplicated column-preview line covering every unlabelled member');
}

// ---------------------------------------------------------------------------
// 6. ELK sizing + bands, no overlap
// ---------------------------------------------------------------------------

{
  const { nodes, edges } = perProcess;
  const srcSet = new Set(edges.map(e => e.source));

  for (const stack of stackNodes) {
    const size = nodeSize(stack);
    assert(size.height === STORE_ROW_H * (stack.rows?.length ?? 1), `FAIL: ${stack.id} height should scale with row count, got ${size.height} for ${stack.rows?.length} rows`);
    const band = bandOf(stack, srcSet);
    assert(band === (stack.direction === 'read' ? 1 : 3), `FAIL: ${stack.id} (${stack.direction}) should be band ${stack.direction === 'read' ? 1 : 3}, got ${band}`);
  }
  console.log('PASS: stack nodeSize scales with row count; bandOf places read stacks in band 1, write stacks in band 3');

  const result: ElkLayoutResult = await computeElkLayout(diagram, { view: 'per-process', workerFactory });
  for (const n of nodes) {
    assert(result.positions[n.id] !== undefined, `FAIL: ELK per-process layout missing a position for ${n.id}`);
  }

  type BandBounds = { min: number; max: number };
  const bounds = new Map<number, BandBounds>();
  for (const n of nodes) {
    const pos = result.positions[n.id];
    if (pos === undefined) continue;
    const band = bandOf(n, srcSet);
    const { height } = nodeSize(n);
    const top = pos.y - height / 2;
    const bottom = pos.y + height / 2;
    const existing = bounds.get(band);
    if (existing === undefined) bounds.set(band, { min: top, max: bottom });
    else { existing.min = Math.min(existing.min, top); existing.max = Math.max(existing.max, bottom); }
  }
  const presentBands = [...bounds.keys()].sort((a, b) => a - b);
  for (let i = 0; i < presentBands.length - 1; i++) {
    const bandN = presentBands[i]!;
    const bandNext = presentBands[i + 1]!;
    if (bandNext !== bandN + 1) continue;
    const bN = bounds.get(bandN)!;
    const bNext = bounds.get(bandNext)!;
    assert(bN.max < bNext.min, `FAIL: band ordering violated between band ${bandN} (max ${bN.max}) and band ${bandNext} (min ${bNext.min}) — nodes overlap`);
  }
  console.log('PASS: ELK per-process layout for hub-diagram has every node positioned with no band overlap');
}

// ---------------------------------------------------------------------------
// 6b. Alignment: a stack with a grouped (clusters-level) row is not taller,
//     for ELK/layout purposes, than a same-row-count stack with none — so
//     both share the same top edge within their band (docs/spec/dfd-store-clusters.md).
// ---------------------------------------------------------------------------

{
  const opts = {
    view: 'per-process' as const,
    collapseLevel: 'clusters' as const,
    clusters: flowModel.clusters,
    subtypeClusters: hubModel.subtypeClusters,
    groups: hubModel.groups,
    entityGroups: hubEntityGroups,
  };
  const { nodes } = buildFlowData(diagram, opts);
  const result = await computeElkLayout(diagram, { ...opts, workerFactory });
  const readStacksWithGroups = nodes.filter(isStack).filter(n => n.direction === 'read');

  const processTwoStack = must(
    readStacksWithGroups.find(n => n.members.some(m => m.storeId === 'db:GrantAlpha')),
    'Process Two\'s read stack (GrantAlpha cluster + hub pair)',
  );
  const processSevenStack = must(
    readStacksWithGroups.find(n => n.members.some(m => m.storeId === 'db:PrivateStore7Read')),
    'Process Seven\'s read stack (hub pair + private store)',
  );
  assert(
    processTwoStack.rows.some(r => r.kind !== 'store'),
    'FAIL: Process Two\'s stack should have a grouped (non-store) row at the clusters level',
  );
  assert(
    processSevenStack.rows.length === processTwoStack.rows.length && processSevenStack.rows.every(r => r.kind === 'store'),
    'FAIL: Process Seven\'s stack should have the same row count as Process Two\'s, all plain store rows',
  );

  const twoPos = must(result.positions[processTwoStack.id], `ELK position for ${processTwoStack.id}`);
  const sevenPos = must(result.positions[processSevenStack.id], `ELK position for ${processSevenStack.id}`);
  const twoTop = twoPos.y - nodeSize(processTwoStack).height / 2;
  const sevenTop = sevenPos.y - nodeSize(processSevenStack).height / 2;
  assert(
    twoTop === sevenTop,
    `FAIL: Process Two's read stack top (${twoTop}) should equal Process Seven's (${sevenTop}) — a grouped row's peek gap must not inflate the ELK-facing height`,
  );
  console.log('PASS: a stack with a grouped row shares its top edge with a same-row-count plain stack in the same band');
}

// ---------------------------------------------------------------------------
// 7. layoutFlowFingerprint unaffected by opts
// ---------------------------------------------------------------------------

{
  const k1 = layoutFlowFingerprint(diagram);
  buildFlowData(diagram, { view: 'per-process' });
  const k2 = layoutFlowFingerprint(diagram);
  assert(k1 === k2, `FAIL: layoutFlowFingerprint(hub-diagram) changed after calling buildFlowData with per-process opts: ${k1} vs ${k2}`);
  console.log('PASS: layoutFlowFingerprint(hub-diagram) is unaffected by buildFlowData opts');
}

// ---------------------------------------------------------------------------
// 8. elk.separateConnectedComponents is scoped to the per-process view
// ---------------------------------------------------------------------------

{
  const defaultData = buildFlowData(diagram);
  const defaultGraph = buildElkGraph(defaultData.nodes, defaultData.edges, undefined);
  assert(
    !('elk.separateConnectedComponents' in defaultGraph.layoutOptions!),
    'FAIL: the default view\'s ELK graph must not carry elk.separateConnectedComponents — today\'s layout must stay unchanged',
  );
  console.log('PASS: the default view\'s ELK graph carries no elk.separateConnectedComponents key');

  const perProcessGraph = buildElkGraph(perProcess.nodes, perProcess.edges, 'per-process');
  assert(
    perProcessGraph.layoutOptions!['elk.separateConnectedComponents'] === 'false',
    'FAIL: the per-process view\'s ELK graph must set elk.separateConnectedComponents: false',
  );
  console.log('PASS: elk.separateConnectedComponents is set only on the per-process view\'s ELK graph');
}

// ---------------------------------------------------------------------------
// 9. duplicate marker: a stack member in one process, the sole same-band
//    store in another — both places carry the duplicate marker
// ---------------------------------------------------------------------------

{
  const sharedEdgeA1: FlowEdge = { from: { kind: 'db', name: 'X', raw: 'db:X' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const sharedEdgeA2: FlowEdge = { from: { kind: 'db', name: 'Y', raw: 'db:Y' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const soleEdgeB: FlowEdge = { from: { kind: 'db', name: 'X', raw: 'db:X' }, to: { kind: 'proc', name: 'b', raw: 'proc:b' }, data: ['id'], flowId: 'f' };
  const synthetic: FlowDiagram = {
    id: 'dup-synthetic', title: 'Dup Synthetic',
    processes: [
      { id: 'a', label: 'A', dottedNumber: '1', inputs: [sharedEdgeA1, sharedEdgeA2], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
      { id: 'b', label: 'B', dottedNumber: '2', inputs: [soleEdgeB], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
    ],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'X', displayName: 'X', flowId: 'f' },
      { kind: 'db', name: 'Y', displayName: 'Y', flowId: 'f' },
    ],
    edges: [sharedEdgeA1, sharedEdgeA2, soleEdgeB],
    subDfds: [],
  };
  const { nodes } = buildFlowData(synthetic, { view: 'per-process' });
  const stackNode = must(nodes.find((n): n is StackNode => isStack(n)), 'process A\'s stack');
  const memberX = must(stackNode.members!.find(m => m.storeId === 'db:X'), 'member X in process A\'s stack');
  assert(memberX.duplicated === true, 'FAIL: X is a stack member for A and the sole store for B — it should be marked duplicated in the stack');
  const plainX = must(nodes.find((n): n is StoreNodeData => n.id === 'db:X' && n.nodeType === 'store'), 'process B\'s plain node for X');
  assert(plainX.duplicated === true, 'FAIL: X is a stack member for A and the sole store for B — it should be marked duplicated as B\'s plain node too');
  console.log('PASS: a store that is a stack member for one process and the sole same-band store for another is marked duplicated in both places');
}

// ---------------------------------------------------------------------------
// 10. Connected view on hub-diagram: cluster tag / author cluster / subtype
//     family / adjacency grouping, and the collapse-level row breakdown
// ---------------------------------------------------------------------------

function hubConnected(collapseLevel: 'stores' | 'clusters' | 'groups', adjacencyStacks?: boolean) {
  return buildFlowData(diagram, {
    view: 'connected',
    collapseLevel,
    clusters: flowModel.clusters,
    subtypeClusters: hubModel.subtypeClusters,
    groups: hubModel.groups,
    entityGroups: hubEntityGroups,
    ...(adjacencyStacks === undefined ? {} : { adjacencyStacks }),
  });
}

{
  const connected = hubConnected('clusters');
  const stacks = connected.nodes.filter(isStack);

  const hubStack = must(stacks.find(n => n.source === 'adjacency' && n.direction === 'read'), 'the connected-view read adjacency stack');
  assert(
    hubStack.members!.map(m => m.storeId).sort().join(',') === 'db:HubStoreA,db:HubStoreB',
    `FAIL: expected the read adjacency stack to be {HubStoreA, HubStoreB}, got ${hubStack.members!.map(m => m.storeId).join(',')}`,
  );
  assert(hubStack.label === '2 stores', `FAIL: expected the read adjacency stack label "2 stores", got "${hubStack.label}"`);
  assert(hubStack.id === 'stack:db:HubStoreA+db:HubStoreB--read', `FAIL: unexpected hub adjacency stack id ${hubStack.id}`);
  console.log('PASS: connected view groups HubStoreA/HubStoreB into one read adjacency stack labelled "2 stores"');

  const subtypeStack = must(stacks.find(n => n.source === 'subtype' && n.direction === 'read'), 'the connected-view RecordBase subtype stack');
  assert(subtypeStack.id === 'subtype:RecordBase--read', `FAIL: unexpected subtype stack id ${subtypeStack.id}`);
  assert(subtypeStack.label === 'RecordBase', `FAIL: expected subtype stack label "RecordBase" (basetype touched), got "${subtypeStack.label}"`);
  assert(subtypeStack.members!.length === 3, `FAIL: expected 3 subtype family members, got ${subtypeStack.members!.length}`);
  assert(
    subtypeStack.rows!.length === 1 && subtypeStack.rows![0]!.kind === 'subtype',
    `FAIL: at the "clusters" collapse level the subtype stack should have one subtype row, got ${JSON.stringify(subtypeStack.rows)}`,
  );
  console.log('PASS: connected view groups the RecordBase family into subtype:RecordBase--read, labelled "RecordBase"; one row at the "clusters" collapse level');

  const rowsAtStores = must(hubConnected('stores').nodes.filter(isStack).find(n => n.id === 'subtype:RecordBase--read'), 'the subtype stack at "stores"').rows!;
  assert(
    rowsAtStores.length === 3 && rowsAtStores.every(r => r.kind === 'store'),
    `FAIL: at the "stores" collapse level the subtype stack should have 3 table rows, got ${JSON.stringify(rowsAtStores)}`,
  );
  console.log('PASS: the RecordBase subtype stack has 3 table rows at the "stores" collapse level');

  const grantsStack = must(stacks.find(n => n.source === 'cluster' && n.direction === 'read'), 'the connected-view grants cluster stack');
  assert(grantsStack.id === 'cluster:grants--read', `FAIL: unexpected cluster stack id ${grantsStack.id}`);
  assert(grantsStack.label === 'Grants', `FAIL: expected cluster stack label "Grants", got "${grantsStack.label}"`);
  assert(grantsStack.members!.length === 2, `FAIL: expected 2 grants cluster members, got ${grantsStack.members!.length}`);
  console.log('PASS: connected view groups GrantAlpha/GrantBeta into cluster:grants--read, labelled "Grants"');

  const writeAdjacency = must(stacks.find(n => n.source === 'adjacency' && n.direction === 'write'), 'the connected-view write adjacency stack');
  assert(
    writeAdjacency.members!.map(m => m.storeId).sort().join(',') === 'db:LogStoreOne,db:LogStoreTwo',
    `FAIL: expected the write adjacency stack to be {LogStoreOne, LogStoreTwo}, got ${writeAdjacency.members!.map(m => m.storeId).join(',')}`,
  );
  assert(writeAdjacency.label === '2 stores', `FAIL: expected the write adjacency stack label "2 stores", got "${writeAdjacency.label}"`);
  assert(
    writeAdjacency.adjacencyWriters?.join(',') === 'Process-Three' && (writeAdjacency.adjacencyReaders ?? []).length === 0,
    `FAIL: expected the write adjacency stack to carry writer Process-Three and no readers, got writers=${JSON.stringify(writeAdjacency.adjacencyWriters)} readers=${JSON.stringify(writeAdjacency.adjacencyReaders)}`,
  );
  console.log('PASS: connected view groups LogStoreOne/LogStoreTwo into one write adjacency stack carrying the shared writer, no readers');
}

{
  const noAdjacency = hubConnected('clusters', false);
  const noAdjStacks = noAdjacency.nodes.filter(isStack);
  assert(!noAdjStacks.some(n => n.source === 'adjacency'), 'FAIL: flow_view.adjacency_stacks: false should leave no adjacency stacks in the connected view');
  const hubA = must(noAdjacency.nodes.find(n => n.id === 'db:HubStoreA'), 'plain HubStoreA node with adjacency_stacks: false');
  assert(hubA.nodeType === 'store', 'FAIL: HubStoreA should render as a plain store node with adjacency_stacks: false');
  const logOne = must(noAdjacency.nodes.find(n => n.id === 'db:LogStoreOne'), 'plain LogStoreOne node with adjacency_stacks: false');
  assert(logOne.nodeType === 'store', 'FAIL: LogStoreOne should render as a plain store node with adjacency_stacks: false');
  assert(noAdjStacks.some(n => n.id === 'subtype:RecordBase--read'), 'FAIL: disabling adjacency should not affect the subtype grouping');
  assert(noAdjStacks.some(n => n.id === 'cluster:grants--read'), 'FAIL: disabling adjacency should not affect the author-cluster grouping');
  console.log('PASS: flow_view.adjacency_stacks: false leaves the hub pair and the log pair as plain nodes; cluster/subtype grouping unaffected');
}

{
  const atGroups = hubConnected('groups');
  const subtypeAtGroups = must(atGroups.nodes.filter(isStack).find(n => n.id === 'subtype:RecordBase--read'), 'the subtype stack at "groups"');
  const groupRow = subtypeAtGroups.rows![0];
  assert(
    subtypeAtGroups.rows!.length === 1 && groupRow?.kind === 'group',
    `FAIL: at the "groups" collapse level the subtype stack should have one group row, got ${JSON.stringify(subtypeAtGroups.rows)}`,
  );
  assert(
    groupRow?.kind === 'group' && groupRow.children?.length === 1 && groupRow.children[0]!.kind === 'subtype',
    `FAIL: the group row should nest exactly one subtype row, got ${JSON.stringify(groupRow?.kind === 'group' ? groupRow.children : undefined)}`,
  );
  console.log('PASS: at the "groups" collapse level the RecordBase subtype stack shows one group row containing the subtype row');
}

// ---------------------------------------------------------------------------
// 10b. Connected view, per-process qualification: a process joins an author
//      cluster / subtype family only when it itself touches 2+ of the
//      source's members; a process touching just one member renders a plain,
//      duplicated copy instead of joining the group another process formed
// ---------------------------------------------------------------------------

{
  // A reads {Alpha, Beta} of cluster C (2 members — A qualifies); B reads
  // only Alpha (1 member — B does not qualify).
  const edgeA1: FlowEdge = { from: { kind: 'db', name: 'Alpha', raw: 'db:Alpha' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const edgeA2: FlowEdge = { from: { kind: 'db', name: 'Beta', raw: 'db:Beta' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const edgeB: FlowEdge = { from: { kind: 'db', name: 'Alpha', raw: 'db:Alpha' }, to: { kind: 'proc', name: 'b', raw: 'proc:b' }, data: ['id'], flowId: 'f' };
  const synthetic: FlowDiagram = {
    id: 'cluster-partial-synthetic', title: 'Cluster Partial Synthetic',
    processes: [
      { id: 'a', label: 'A', dottedNumber: '1', inputs: [edgeA1, edgeA2], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
      { id: 'b', label: 'B', dottedNumber: '2', inputs: [edgeB], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
    ],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'Alpha', displayName: 'Alpha', flowId: 'f' },
      { kind: 'db', name: 'Beta', displayName: 'Beta', flowId: 'f' },
    ],
    edges: [edgeA1, edgeA2, edgeB],
    subDfds: [],
  };
  const clusterC = { slug: 'c', label: 'C', entities: ['Alpha', 'Beta'], body: '', bodyHtml: '' };
  const { nodes, edges } = buildFlowData(synthetic, { view: 'connected', clusters: [clusterC] });

  const clusterNode = must(nodes.filter(isStack).find(n => n.id === 'cluster:c--read'), 'cluster:c--read stack');
  assert(
    clusterNode.members!.map(m => m.storeId).sort().join(',') === 'db:Alpha,db:Beta',
    `FAIL: expected cluster:c--read to have members {Alpha, Beta}, got ${clusterNode.members!.map(m => m.storeId).join(',')}`,
  );
  const clusterEdge = must(edges.find(e => e.source === clusterNode.id), 'A\'s edge out of cluster:c--read');
  assert(clusterEdge.target === 'proc:a', `FAIL: expected A's cluster edge to target proc:a, got ${clusterEdge.target}`);
  const plainAlpha = must(nodes.find((n): n is StoreNodeData => n.id === 'db:Alpha' && n.nodeType === 'store'), 'plain db:Alpha node fed by B');
  assert(plainAlpha.duplicated === true, 'FAIL: Alpha is a cluster member for A and B\'s sole touch — the plain copy should be marked duplicated');
  const alphaMember = must(clusterNode.members!.find(m => m.storeId === 'db:Alpha'), 'Alpha as a cluster:c--read member');
  assert(alphaMember.duplicated === true, 'FAIL: Alpha also has a plain copy (B) — the cluster member entry should be marked duplicated too');
  const betaMember = must(clusterNode.members!.find(m => m.storeId === 'db:Beta'), 'Beta as a cluster:c--read member');
  assert(betaMember.duplicated === false, 'FAIL: Beta has no plain copy anywhere — it should not be marked duplicated');
  const bEdge = must(edges.find(e => e.source === 'db:Alpha'), 'B\'s plain edge to db:Alpha');
  assert(bEdge.target === 'proc:b', `FAIL: expected B's plain edge to target proc:b, got ${bEdge.target}`);
  console.log('PASS: connected view — A qualifies cluster:c--read with {Alpha, Beta}; B\'s lone Alpha touch renders a plain, duplicated copy');
}

{
  // Mirrors the cluster case for a subtype family: A reads {Sub1, Sub2} of
  // basetype Base (2 members — A qualifies); B reads only Sub1.
  const edgeA1: FlowEdge = { from: { kind: 'db', name: 'Sub1', raw: 'db:Sub1' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const edgeA2: FlowEdge = { from: { kind: 'db', name: 'Sub2', raw: 'db:Sub2' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const edgeB: FlowEdge = { from: { kind: 'db', name: 'Sub1', raw: 'db:Sub1' }, to: { kind: 'proc', name: 'b', raw: 'proc:b' }, data: ['id'], flowId: 'f' };
  const synthetic: FlowDiagram = {
    id: 'subtype-partial-synthetic', title: 'Subtype Partial Synthetic',
    processes: [
      { id: 'a', label: 'A', dottedNumber: '1', inputs: [edgeA1, edgeA2], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
      { id: 'b', label: 'B', dottedNumber: '2', inputs: [edgeB], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
    ],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'Sub1', displayName: 'Sub1', flowId: 'f' },
      { kind: 'db', name: 'Sub2', displayName: 'Sub2', flowId: 'f' },
    ],
    edges: [edgeA1, edgeA2, edgeB],
    subDfds: [],
  };
  const subtypeFamily = { basetype: 'Base', exclusive: false, hasDiscriminator: false, members: ['Sub1', 'Sub2'] };
  const { nodes, edges } = buildFlowData(synthetic, { view: 'connected', subtypeClusters: [subtypeFamily] });

  const subtypeNode = must(nodes.filter(isStack).find(n => n.id === 'subtype:Base--read'), 'subtype:Base--read stack');
  assert(
    subtypeNode.members!.map(m => m.storeId).sort().join(',') === 'db:Sub1,db:Sub2',
    `FAIL: expected subtype:Base--read to have members {Sub1, Sub2}, got ${subtypeNode.members!.map(m => m.storeId).join(',')}`,
  );
  assert(subtypeNode.label === 'Base subtypes', `FAIL: expected label "Base subtypes" (basetype untouched), got "${subtypeNode.label}"`);
  const plainSub1 = must(nodes.find((n): n is StoreNodeData => n.id === 'db:Sub1' && n.nodeType === 'store'), 'plain db:Sub1 node fed by B');
  assert(plainSub1.duplicated === true, 'FAIL: Sub1 is a subtype-family member for A and B\'s sole touch — the plain copy should be marked duplicated');
  const bEdge = must(edges.find(e => e.source === 'db:Sub1'), 'B\'s plain edge to db:Sub1');
  assert(bEdge.target === 'proc:b', `FAIL: expected B's plain edge to target proc:b, got ${bEdge.target}`);
  console.log('PASS: connected view — A qualifies subtype:Base--read with {Sub1, Sub2}; B\'s lone Sub1 touch renders a plain, duplicated copy');
}

// ---------------------------------------------------------------------------
// 10c. Stack width covers the widest RENDERED ROW text, not just member
//      display names — a subtype row's "<Basetype> subtypes (N)" label can
//      outrun every member's own short name (docs/spec/dfd-store-clusters.md).
// ---------------------------------------------------------------------------

{
  const edgeA1: FlowEdge = { from: { kind: 'db', name: 'S1', raw: 'db:S1' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const edgeA2: FlowEdge = { from: { kind: 'db', name: 'S2', raw: 'db:S2' }, to: { kind: 'proc', name: 'a', raw: 'proc:a' }, data: ['id'], flowId: 'f' };
  const synthetic: FlowDiagram = {
    id: 'subtype-wide-label-synthetic', title: 'Subtype Wide Label Synthetic',
    processes: [
      { id: 'a', label: 'A', dottedNumber: '1', inputs: [edgeA1, edgeA2], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: 'f' },
    ],
    externals: [],
    storeRefs: [
      { kind: 'db', name: 'S1', displayName: 'S1', flowId: 'f' },
      { kind: 'db', name: 'S2', displayName: 'S2', flowId: 'f' },
    ],
    edges: [edgeA1, edgeA2],
    subDfds: [],
  };
  const subtypeFamily = { basetype: 'Base', exclusive: false, hasDiscriminator: false, members: ['S1', 'S2'] };
  const { nodes } = buildFlowData(synthetic, { view: 'connected', collapseLevel: 'clusters', subtypeClusters: [subtypeFamily] });

  const subtypeStack = must(nodes.filter(isStack).find(n => n.id === 'subtype:Base--read'), 'subtype:Base--read stack');
  const subtypeRow = must(subtypeStack.rows.find(r => r.kind === 'subtype'), 'the stack\'s subtype row');
  assert(subtypeRow.kind === 'subtype' && subtypeRow.label === 'Base subtypes' && subtypeRow.count === 2, `FAIL: expected a "Base subtypes" row with count 2, got ${JSON.stringify(subtypeRow)}`);

  const rowText = `${(subtypeRow as { label: string }).label} (2)`;
  const expectedWidth = STORE_CAP_W + storeBodyWidth(rowText);
  const size = nodeSize(subtypeStack);
  assert(size.width === expectedWidth, `FAIL: stack width should cover the "${rowText}" row (${expectedWidth}px incl. cap + badge slot), got ${size.width}`);

  const memberOnlyWidth = STORE_CAP_W + Math.max(storeBodyWidth('S1'), storeBodyWidth('S2'));
  assert(size.width > memberOnlyWidth, `FAIL: sizing from members alone (${memberOnlyWidth}px) would clip "${rowText}" — width must exceed it`);
  console.log('PASS: a stack\'s width covers its widest rendered row text (grouped label + count), not just member display names');
}

// ---------------------------------------------------------------------------
// 10d. layoutFlowFingerprint(hub-diagram) is unaffected by the connected view
//      at every collapse level
// ---------------------------------------------------------------------------

{
  const k0 = layoutFlowFingerprint(diagram);
  for (const collapseLevel of ['stores', 'clusters', 'groups'] as const) {
    hubConnected(collapseLevel);
    const k = layoutFlowFingerprint(diagram);
    assert(k === k0, `FAIL: layoutFlowFingerprint(hub-diagram) changed after buildFlowData with connected-view opts at collapseLevel "${collapseLevel}": ${k0} vs ${k}`);
  }
  console.log('PASS: layoutFlowFingerprint(hub-diagram) is unaffected by the connected view at every collapse level');
}

// ---------------------------------------------------------------------------
// 11. models/llm-memory-db-mssql: Merge Tag's cluster:tag-junctions rewrite
// ---------------------------------------------------------------------------

{
  const { flowModel: llmFlowModel } = await parseFlows(LLM_MEMORY_DB);
  const { model: llmModel } = await parseModels(LLM_MEMORY_DB);
  const tagDiagram = must(findDiagram(llmFlowModel.diagrams, 'tag-administration'), 'tag-administration diagram');
  const llmEntityGroups: Record<string, string> = {};
  for (const node of llmModel.nodes) if (node.group) llmEntityGroups[node.id] = node.group;

  const connected = buildFlowData(tagDiagram, {
    view: 'connected',
    collapseLevel: 'clusters',
    clusters: llmFlowModel.clusters,
    subtypeClusters: llmModel.subtypeClusters,
    groups: llmModel.groups,
    entityGroups: llmEntityGroups,
  });

  const junctionsStack = must(
    connected.nodes.filter(isStack).find(n => n.id === 'cluster:tag-junctions--write'),
    'cluster:tag-junctions--write stack',
  );
  assert(
    junctionsStack.members!.map(m => m.storeId).sort().join(',') === 'db:Artifact_Tag,db:Milestone_Tag,db:Project_Tag,db:Task_Tag',
    `FAIL: expected the tag-junctions cluster to have the four junction members, got ${junctionsStack.members!.map(m => m.storeId).join(',')}`,
  );
  const junctionEdge = must(
    connected.edges.find(e => e.source === junctionsStack.id || e.target === junctionsStack.id),
    'the rendered edge into/out of cluster:tag-junctions--write',
  );
  assert(junctionEdge.label === 'Tag junctions', `FAIL: expected the cluster edge chip "Tag junctions", got "${junctionEdge.label}"`);
  console.log('PASS: Merge Tag\'s cluster:tag-junctions rewrite groups the four junction tables under cluster:tag-junctions--write with the "Tag junctions" chip');

  const junctionsReadStack = must(
    connected.nodes.filter(isStack).find(n => n.id === 'cluster:tag-junctions--read'),
    'cluster:tag-junctions--read stack',
  );
  assert(
    junctionsReadStack.members!.map(m => m.storeId).sort().join(',') === 'db:Artifact_Tag,db:Milestone_Tag,db:Project_Tag,db:Task_Tag',
    `FAIL: expected the four plain db: junction inputs to group implicitly under cluster:tag-junctions--read, got ${junctionsReadStack.members!.map(m => m.storeId).join(',')}`,
  );
  console.log('PASS: Merge Tag\'s four plain db: junction inputs group implicitly under cluster:tag-junctions--read');

  // Fingerprint invariance: the pre-rewrite (unqualified db:) form of Merge-Tag
  // is kept as a fixture — a git lookup would break on a squashed or shallow
  // checkout — and its topology hash must equal the cluster form's.
  const preRewriteMergeTag = readFileSync(join(ROOT, 'test/fixtures/merge-tag-before-clusters.md'), 'utf8');
  const tmpModelDir = mkdtempSync(join(tmpdir(), 'tag-junctions-fp-'));
  cpSync(LLM_MEMORY_DB, tmpModelDir, { recursive: true });
  writeFileSync(join(tmpModelDir, 'flows/tag-administration/Merge-Tag.md'), preRewriteMergeTag);
  const { flowModel: preFlowModel } = await parseFlows(tmpModelDir);
  const preDiagram = must(findDiagram(preFlowModel.diagrams, 'tag-administration'), 'tag-administration diagram (pre-rewrite)');
  assert(
    layoutFlowFingerprint(tagDiagram) === layoutFlowFingerprint(preDiagram),
    'FAIL: layoutFlowFingerprint(tag-administration) changed after the cluster:tag-junctions rewrite',
  );
  console.log('PASS: layoutFlowFingerprint(tag-administration) is unchanged by the cluster:tag-junctions rewrite');
}

// ---------------------------------------------------------------------------
// 12. models/key-inherited: Validate-Customer's Party/Person/Business reads
//     group under subtype:Party--read, labelled "Party"
// ---------------------------------------------------------------------------

{
  const { flowModel: keyFlowModel } = await parseFlows(KEY_INHERITED);
  const { model: keyModel } = await parseModels(KEY_INHERITED);
  const orderDiagram = must(findDiagram(keyFlowModel.diagrams, 'Create-Sales-Order'), 'Create-Sales-Order sub-DFD');
  const keyEntityGroups: Record<string, string> = {};
  for (const node of keyModel.nodes) if (node.group) keyEntityGroups[node.id] = node.group;

  const connected = buildFlowData(orderDiagram, {
    view: 'connected',
    collapseLevel: 'clusters',
    clusters: keyFlowModel.clusters,
    subtypeClusters: keyModel.subtypeClusters,
    groups: keyModel.groups,
    entityGroups: keyEntityGroups,
  });

  const partyStack = must(connected.nodes.filter(isStack).find(n => n.id === 'subtype:Party--read'), 'subtype:Party--read stack');
  assert(
    partyStack.members!.map(m => m.storeId).sort().join(',') === 'db:Business,db:Party,db:Person',
    `FAIL: expected the Party subtype stack to have Party/Person/Business, got ${partyStack.members!.map(m => m.storeId).join(',')}`,
  );
  assert(partyStack.label === 'Party', `FAIL: expected the Party subtype stack label "Party", got "${partyStack.label}"`);
  console.log('PASS: Validate-Customer\'s Party/Person/Business reads group under subtype:Party--read, labelled "Party"');
}

// ---------------------------------------------------------------------------
// 13. layoutKeyForView — per-view drag-position key derivation
// ---------------------------------------------------------------------------

{
  assert(
    layoutKeyForView('fp123', 'per-process') !== layoutKeyForView('fp123', 'connected'),
    'FAIL: the same fingerprint key must diverge between per-process and connected view',
  );
  assert(
    layoutKeyForView('fp123', 'per-process') === layoutKeyForView('fp123', 'per-process'),
    'FAIL: layoutKeyForView is deterministic for the same fingerprint + view',
  );
  assert(
    layoutKeyForView('', 'per-process') === '',
    'FAIL: an empty base key (diagram not found in the fingerprint map) stays empty — no view suffix on a missing key',
  );
  console.log('PASS: layoutKeyForView diverges per view, is deterministic, and passes through an empty base key');
}

console.log('\nAll test-flow-view-grouping assertions ran.');
process.exit(process.exitCode ?? 0);
