/**
 * test-flow-clusters-parse.ts — clusters/*.md registry parse + cluster: token
 * expansion (flow-clusters.ts, flow-parse.ts).
 *
 * Covers:
 *  - clusters/*.md registry parse from disk (broken-flows-model's role-grants.md,
 *    referenced by a process cluster: entry)
 *  - a model with no clusters/ folder parses with an empty registry, no error
 *  - cluster: entry expansion into per-member db: edges, each carrying its own
 *    columns and the cluster tag
 *  - entry label: overrides the expanded edges' label; without one, the
 *    cluster's label: is used
 *  - layoutFlowFingerprint equality between a cluster: token and the
 *    equivalent hand-written db: edges
 *  - unresolved-slug trace (flow.unknown_cluster) and non-member trace
 *    (flow.cluster_member_unknown), left for the validator to strip
 *  - an empty or whitespace-only label: is treated as absent
 *  - a map-shaped data: on a plain db: entry (no cluster: prefix) never
 *    produces an object-valued edge.data
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert } from '../assert';
import { parseFlows } from '../../src/flows/flow-parse';
import { layoutFlowFingerprint } from '../../src/flows/flow-fingerprint';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const ROOT = resolve(import.meta.dir, '../..');
const BROKEN_FLOWS_MODEL = join(ROOT, 'test/fixtures/broken-flows-model');

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 1. Registry parse from disk: broken-flows-model/clusters/role-grants.md
// ---------------------------------------------------------------------------

{
  const { flowModel } = await parseFlows(BROKEN_FLOWS_MODEL);
  const cluster = flowModel.clusters.find(c => c.slug === 'role-grants');
  assert(cluster !== undefined, 'FAIL: role-grants cluster not found in registry');
  assert(cluster!.label === 'Role Grants', `FAIL: expected label 'Role Grants', got '${cluster!.label}'`);
  assert(
    cluster!.entities.join(',') === 'RoleGrant,PermissionGrant',
    `FAIL: expected entities [RoleGrant, PermissionGrant], got ${JSON.stringify(cluster!.entities)}`,
  );
  assert(cluster!.body.includes('Grants of roles'), 'FAIL: cluster body not parsed');
  assert(cluster!.bodyHtml.includes('<p>'), 'FAIL: cluster bodyHtml not rendered');

  // Expansion exercised from disk: Process-Checkout's cluster:role-grants output
  // expands into one db: edge per mapped member.
  const diagram = findDiagram(flowModel.diagrams, 'checkout');
  assert(diagram !== undefined, 'FAIL: checkout diagram not found');
  const process = diagram!.processes.find(p => p.id === 'Process-Checkout');
  assert(process !== undefined, 'FAIL: Process-Checkout process not found');

  const roleGrantEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'RoleGrant');
  const permissionGrantEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'PermissionGrant');
  assert(roleGrantEdge !== undefined, 'FAIL: expanded db:RoleGrant edge not found');
  assert(permissionGrantEdge !== undefined, 'FAIL: expanded db:PermissionGrant edge not found');
  assert(
    Array.isArray(roleGrantEdge!.data) && roleGrantEdge!.data.join(',') === 'id,role_id',
    `FAIL: db:RoleGrant edge should carry its own columns, got ${JSON.stringify(roleGrantEdge!.data)}`,
  );
  assert(
    Array.isArray(permissionGrantEdge!.data) && permissionGrantEdge!.data.join(',') === 'id,permission_id',
    `FAIL: db:PermissionGrant edge should carry its own columns, got ${JSON.stringify(permissionGrantEdge!.data)}`,
  );
  assert(roleGrantEdge!.cluster?.slug === 'role-grants', 'FAIL: expanded edge missing cluster tag slug');
  assert(roleGrantEdge!.cluster?.label === 'Role Grants', 'FAIL: expanded edge cluster tag label mismatch');
  assert(roleGrantEdge!.clusterIssue === undefined, 'FAIL: a resolved cluster member must carry no clusterIssue');
  console.log('PASS: clusters/*.md registry parses from disk and a cluster: entry expands into per-member db: edges');
}

// ---------------------------------------------------------------------------
// 2. No clusters/ folder → empty registry, no error
// ---------------------------------------------------------------------------

{
  const root = mkdtempSync(join(tmpdir(), 'ignatius-no-clusters-'));
  mkdirSync(join(root, 'flows', 'checkout'), { recursive: true });
  writeFileSync(
    join(root, 'flows', 'checkout', 'Place-Order.md'),
    '---\nprocess: Place Order\n---\n\nBody.\n',
  );

  const { flowModel, globalErrors } = await parseFlows(root);
  assert(globalErrors.length === 0, `FAIL: unexpected globalErrors: ${JSON.stringify(globalErrors)}`);
  assert(flowModel.clusters.length === 0, `FAIL: expected empty cluster registry, got ${JSON.stringify(flowModel.clusters)}`);
  rmSync(root, { recursive: true, force: true });
  console.log('PASS: a model with no clusters/ folder parses with an empty registry and no error');
}

// ---------------------------------------------------------------------------
// Fixture for tests 3-8: a model with a two-member cluster, an entry-label
// override, a cluster-label fallback, an unresolved slug, and a non-member.
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'ignatius-flow-clusters-'));
mkdirSync(join(root, 'flows', 'admin'), { recursive: true });
mkdirSync(join(root, 'clusters'), { recursive: true });

writeFileSync(
  join(root, 'clusters', 'tag-junctions.md'),
  [
    '---',
    'label: Tag Junctions',
    'entities:',
    '  - ProjectTag',
    '  - ArtifactTag',
    '---',
    '',
    'Junction tables tagging entities.',
    '',
  ].join('\n'),
);

writeFileSync(
  join(root, 'flows', 'admin', 'Merge-Tag.md'),
  [
    '---',
    'process: Merge Tag',
    'outputs:',
    '  - to: cluster:tag-junctions',
    '    data:',
    '      ProjectTag: [id, tag_id]',
    '      ArtifactTag: [id, tag_id]',
    '  - to: cluster:tag-junctions',
    '    label: overridden label',
    '    data:',
    '      ProjectTag: [id, tag_id]',
    '  - to: cluster:missing-cluster',
    '    data:',
    '      SomeEntity: [id]',
    '  - to: cluster:tag-junctions',
    '    data:',
    '      NotAMember: [id]',
    '  - to: db:ProjectTag',
    '    data: [id, tag_id]',
    '  - to: db:ArtifactTag',
    '    data: [id, tag_id]',
    '  - to: db:BlankLabel',
    '    data: irrelevant',
    '    label: "   "',
    '  - to: db:MapTypo',
    '    data:',
    '      SomeColumn: [a, b]',
    '---',
    '',
    'Body.',
    '',
  ].join('\n'),
);

const { flowModel, globalErrors } = await parseFlows(root);
assert(globalErrors.length === 0, `FAIL: unexpected globalErrors: ${JSON.stringify(globalErrors)}`);
const diagram = findDiagram(flowModel.diagrams, 'admin');
assert(diagram !== undefined, 'FAIL: admin diagram not found');
const process = diagram!.processes.find(p => p.id === 'Merge-Tag');
assert(process !== undefined, 'FAIL: Merge-Tag process not found');

const projectTagEdges = process!.outputs.filter(e => e.to.kind === 'db' && e.to.name === 'ProjectTag' && e.cluster !== undefined);
const artifactTagEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'ArtifactTag' && e.cluster !== undefined);

rmSync(root, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 3. Expansion with per-member columns and cluster tag
// ---------------------------------------------------------------------------

assert(artifactTagEdge !== undefined, 'FAIL: expanded db:ArtifactTag edge not found');
assert(
  Array.isArray(artifactTagEdge!.data) && artifactTagEdge!.data.join(',') === 'id,tag_id',
  `FAIL: expanded db:ArtifactTag should carry its own columns, got ${JSON.stringify(artifactTagEdge!.data)}`,
);
assert(artifactTagEdge!.cluster?.slug === 'tag-junctions', 'FAIL: expanded edge cluster tag slug mismatch');
assert(artifactTagEdge!.cluster?.label === 'Tag Junctions', 'FAIL: expanded edge cluster tag label mismatch');
console.log('PASS: a cluster: entry expands into one db: edge per member, each carrying its own columns and the cluster tag');

// ---------------------------------------------------------------------------
// 4. Entry label overrides cluster label; without one, cluster label is used
// ---------------------------------------------------------------------------

assert(projectTagEdges.length === 2, `FAIL: expected 2 expanded db:ProjectTag edges (two cluster entries), got ${projectTagEdges.length}`);
const unlabelledEntryEdge = projectTagEdges.find(e => e.label === 'Tag Junctions');
const labelledEntryEdge = projectTagEdges.find(e => e.label === 'overridden label');
assert(unlabelledEntryEdge !== undefined, `FAIL: an entry with no label: should fall back to the cluster's label, got labels ${JSON.stringify(projectTagEdges.map(e => e.label))}`);
assert(labelledEntryEdge !== undefined, `FAIL: an entry's own label: should win over the cluster's label, got labels ${JSON.stringify(projectTagEdges.map(e => e.label))}`);
console.log("PASS: an entry's own label: becomes the expanded edges' label; without one the cluster's label: is used");

// ---------------------------------------------------------------------------
// 5. Fingerprint equality: cluster: token vs the equivalent plain db: entries
// ---------------------------------------------------------------------------

const tokenDiagram: FlowDiagram = {
  id: 'fp-check',
  title: 'Fingerprint Check',
  processes: [{
    id: 'Merge-Tag',
    label: 'Merge Tag',
    dottedNumber: '1',
    inputs: [],
    outputs: [artifactTagEdge!, projectTagEdges[0]!],
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId: 'fp-check',
  }],
  externals: [],
  storeRefs: [
    { kind: 'db', name: 'ArtifactTag', displayName: 'ArtifactTag', flowId: 'fp-check' },
    { kind: 'db', name: 'ProjectTag', displayName: 'ProjectTag', flowId: 'fp-check' },
  ],
  edges: [artifactTagEdge!, projectTagEdges[0]!],
  subDfds: [],
};

const plainProjectTagEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'ProjectTag' && e.cluster === undefined);
const plainArtifactTagEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'ArtifactTag' && e.cluster === undefined);
assert(plainProjectTagEdge !== undefined, 'FAIL: plain db:ProjectTag edge not found');
assert(plainArtifactTagEdge !== undefined, 'FAIL: plain db:ArtifactTag edge not found');

const plainDiagram: FlowDiagram = {
  ...tokenDiagram,
  processes: [{ ...tokenDiagram.processes[0]!, outputs: [plainArtifactTagEdge!, plainProjectTagEdge!] }],
  edges: [plainArtifactTagEdge!, plainProjectTagEdge!],
};

const tokenFingerprint = layoutFlowFingerprint(tokenDiagram);
const plainFingerprint = layoutFlowFingerprint(plainDiagram);
assert(
  tokenFingerprint === plainFingerprint,
  `FAIL: cluster: token and equivalent db: entries should fingerprint identically: ${tokenFingerprint} vs ${plainFingerprint}`,
);
console.log('PASS: layoutFlowFingerprint is identical between a cluster: token diagram and its plain db: equivalent');

// ---------------------------------------------------------------------------
// 6. Unresolved-slug trace: cluster:missing-cluster leaves a marker instead
//    of being silently dropped
// ---------------------------------------------------------------------------

const unknownClusterEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'SomeEntity');
assert(unknownClusterEdge !== undefined, 'FAIL: an unresolved cluster: slug should still leave a traceable edge');
assert(
  unknownClusterEdge!.clusterIssue === 'unknown_cluster',
  `FAIL: expected clusterIssue 'unknown_cluster', got '${unknownClusterEdge!.clusterIssue}'`,
);
assert(unknownClusterEdge!.cluster?.slug === 'missing-cluster', 'FAIL: unresolved cluster edge missing slug tag');
console.log('PASS: an unresolved cluster: slug leaves an unknown_cluster trace instead of being silently dropped');

// ---------------------------------------------------------------------------
// 7. Non-member trace: a data: map key outside the cluster's entities:
// ---------------------------------------------------------------------------

const nonMemberEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'NotAMember');
assert(nonMemberEdge !== undefined, 'FAIL: a non-member data: key should still leave a traceable edge');
assert(
  nonMemberEdge!.clusterIssue === 'cluster_member_unknown',
  `FAIL: expected clusterIssue 'cluster_member_unknown', got '${nonMemberEdge!.clusterIssue}'`,
);
console.log('PASS: a data: map key outside the cluster entities: leaves a cluster_member_unknown trace instead of being silently dropped');

// ---------------------------------------------------------------------------
// 8. An empty or whitespace-only label: is treated as absent
// ---------------------------------------------------------------------------

const blankLabelEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'BlankLabel');
assert(blankLabelEdge !== undefined, 'FAIL: db:BlankLabel output edge not found');
assert(blankLabelEdge!.label === undefined, `FAIL: a whitespace-only label: should be treated as absent, got '${blankLabelEdge!.label}'`);
console.log('PASS: an empty or whitespace-only label: is treated as absent');

// ---------------------------------------------------------------------------
// 9. A map-shaped data: on a plain db: entry (no cluster: prefix — e.g. a
//    typo) must not produce an object-valued edge.data
// ---------------------------------------------------------------------------

const mapTypoEdge = process!.outputs.find(e => e.to.kind === 'db' && e.to.name === 'MapTypo');
assert(mapTypoEdge !== undefined, 'FAIL: db:MapTypo output edge not found');
assert(
  typeof mapTypoEdge!.data === 'string' || Array.isArray(mapTypoEdge!.data),
  `FAIL: a map-shaped data: on a plain db: entry must not leak an object into edge.data, got ${JSON.stringify(mapTypoEdge!.data)}`,
);
console.log('PASS: a map-shaped data: on a plain db: entry never produces an object-valued edge.data');

console.log('\nAll flow-clusters-parse tests passed.');
