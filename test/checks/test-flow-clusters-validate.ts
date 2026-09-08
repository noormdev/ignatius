/**
 * test-flow-clusters-validate.ts — the five flow.cluster_* validation rules
 * (flow-validate.ts) against two disk fixtures under broken-flows-model.
 *
 * Covers:
 *  - flow.unknown_cluster (Class B): Bad-Cluster-Ref's cluster:no-such-cluster
 *    entry strips its expanded edge.
 *  - flow.cluster_member_unknown (Class B): the cluster:role-grants entry
 *    mapping NotAMember strips that member's edge only.
 *  - flow.cluster_no_members (Class A): the cluster:role-grants entry with an
 *    empty data: map is recorded, and its synthetic db:role-grants marker
 *    edge is stripped from the cleaned model.
 *  - flow.cluster_entity_unknown (Class A): role-grants-invalid.md names
 *    GhostRole, absent from the entity catalog.
 *  - flow.cluster_overlap (Class A): role-grants-invalid.md and role-grants.md
 *    both claim RoleGrant.
 */

import { resolve, join } from 'node:path';
import { assert } from '../assert';
import { parseFlows } from '../../src/flows/flow-parse';
import { validateFlows } from '../../src/flows/flow-validate';
import type { FlowDiagram } from '../../src/flows/flow-parse';
import type { Model, ModelNode } from '../../src/model/parse';
import type { RuleId } from '../../src/model/validate';
import { defaultTheme } from '../../src/theme/theme-defaults';
import { defaultBranding } from '../../src/theme/branding-defaults';

const ROOT = resolve(import.meta.dir, '../..');
const BROKEN_FLOWS_MODEL = join(ROOT, 'test/fixtures/broken-flows-model');

function baseNode(id: string): ModelNode {
  return {
    id,
    classification: 'independent',
    pk: ['id'],
    columns: { id: { type: 'integer' }, role_id: { type: 'integer' }, permission_id: { type: 'integer' } },
    alternateKeys: [],
    bodyHtml: '',
  };
}

function baseEntityModel(nodes: ModelNode[]): Model {
  return {
    groups: {},
    nodes,
    edges: [],
    subtypeClusters: [],
    theme: defaultTheme,
    branding: defaultBranding,
  };
}

// Only RoleGrant and PermissionGrant are known — GhostRole (role-grants-invalid.md)
// and GhostEntity/SomeEntity/NotAMember (used elsewhere in the fixture) are not.
const entityModel = baseEntityModel([baseNode('RoleGrant'), baseNode('PermissionGrant')]);

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const { flowModel } = await parseFlows(BROKEN_FLOWS_MODEL);
const result = validateFlows(flowModel, entityModel);
const errors = result.flowErrors;

// ---------------------------------------------------------------------------
// 1. flow.unknown_cluster fires and strips the expanded edge
// ---------------------------------------------------------------------------

{
  const unknownClusterErrors = errors.filter(e => e.ruleId === 'flow.unknown_cluster');
  assert(unknownClusterErrors.length === 1, `FAIL: expected exactly 1 flow.unknown_cluster finding, got ${unknownClusterErrors.length}`);

  const checkout = findDiagram(result.cleanedFlowModel.diagrams, 'checkout');
  assert(checkout !== undefined, 'FAIL: checkout diagram not found in cleaned model');
  const survivingUnknownEdge = checkout!.edges.find(e => e.to.kind === 'db' && e.to.name === 'SomeEntity');
  assert(survivingUnknownEdge === undefined, 'FAIL: cluster:no-such-cluster edge should be stripped from cleanedFlowModel');
  console.log('PASS: flow.unknown_cluster fires and strips the expanded edge');
}

// ---------------------------------------------------------------------------
// 2. flow.cluster_member_unknown fires and strips only that member's edge
// ---------------------------------------------------------------------------

{
  const memberUnknownErrors = errors.filter(e => e.ruleId === 'flow.cluster_member_unknown');
  assert(memberUnknownErrors.length === 1, `FAIL: expected exactly 1 flow.cluster_member_unknown finding, got ${memberUnknownErrors.length}`);

  const checkout = findDiagram(result.cleanedFlowModel.diagrams, 'checkout');
  const survivingNotAMemberEdge = checkout!.edges.find(e => e.to.kind === 'db' && e.to.name === 'NotAMember');
  assert(survivingNotAMemberEdge === undefined, 'FAIL: NotAMember edge should be stripped from cleanedFlowModel');

  // The valid role-grants expansion on Process-Checkout must survive untouched.
  const roleGrantEdge = checkout!.edges.find(e => e.to.kind === 'db' && e.to.name === 'RoleGrant');
  assert(roleGrantEdge !== undefined, 'FAIL: the valid cluster:role-grants → RoleGrant edge should survive cleaning');
  console.log('PASS: flow.cluster_member_unknown fires and strips only the unmapped member edge');
}

// ---------------------------------------------------------------------------
// 3. flow.cluster_no_members fires (recorded) and the marker edge is stripped
// ---------------------------------------------------------------------------

{
  const noMembersErrors = errors.filter(e => e.ruleId === 'flow.cluster_no_members');
  assert(noMembersErrors.length === 1, `FAIL: expected exactly 1 flow.cluster_no_members finding, got ${noMembersErrors.length}`);

  const checkout = findDiagram(result.cleanedFlowModel.diagrams, 'checkout');
  const markerEdge = checkout!.edges.find(e =>
    (e.to.kind === 'db' && e.to.name === 'role-grants') || (e.from.kind === 'db' && e.from.name === 'role-grants'),
  );
  assert(markerEdge === undefined, 'FAIL: the synthetic db:role-grants marker edge must not survive into cleanedFlowModel');

  const markerStoreRef = checkout!.storeRefs.find(s => s.kind === 'db' && s.name === 'role-grants');
  assert(markerStoreRef === undefined, 'FAIL: the synthetic marker must not reach the cleaned model as a store');
  console.log('PASS: flow.cluster_no_members is recorded and its marker edge never reaches the cleaned model');
}

// ---------------------------------------------------------------------------
// 4. flow.cluster_entity_unknown fires for GhostRole (role-grants-invalid.md)
// ---------------------------------------------------------------------------

{
  const entityUnknownErrors = errors.filter(e => e.ruleId === 'flow.cluster_entity_unknown');
  assert(entityUnknownErrors.length === 1, `FAIL: expected exactly 1 flow.cluster_entity_unknown finding, got ${entityUnknownErrors.length}`);
  assert(
    entityUnknownErrors[0]!.message.includes('GhostRole'),
    `FAIL: flow.cluster_entity_unknown message should name GhostRole, got '${entityUnknownErrors[0]!.message}'`,
  );
  console.log('PASS: flow.cluster_entity_unknown fires for role-grants-invalid.md\'s GhostRole');
}

// ---------------------------------------------------------------------------
// 5. flow.cluster_overlap fires for RoleGrant (claimed by both cluster files)
// ---------------------------------------------------------------------------

{
  const overlapErrors = errors.filter(e => e.ruleId === 'flow.cluster_overlap');
  assert(overlapErrors.length === 1, `FAIL: expected exactly 1 flow.cluster_overlap finding, got ${overlapErrors.length}`);
  assert(
    overlapErrors[0]!.message.includes('RoleGrant'),
    `FAIL: flow.cluster_overlap message should name RoleGrant, got '${overlapErrors[0]!.message}'`,
  );
  console.log('PASS: flow.cluster_overlap fires for RoleGrant, claimed by role-grants.md and role-grants-invalid.md');
}

// ---------------------------------------------------------------------------
// 6. RULES registry carries all five new rule ids with the right class
// ---------------------------------------------------------------------------

{
  const { RULES } = await import('../../src/model/validate');
  const expectedClasses: [RuleId, 'A' | 'B'][] = [
    ['flow.unknown_cluster', 'B'],
    ['flow.cluster_member_unknown', 'B'],
    ['flow.cluster_no_members', 'A'],
    ['flow.cluster_entity_unknown', 'A'],
    ['flow.cluster_overlap', 'A'],
  ];
  for (const [ruleId, cls] of expectedClasses) {
    const entry = RULES[ruleId];
    assert(entry !== undefined, `FAIL: RULES registry missing entry for '${ruleId}'`);
    assert(entry?.class === cls, `FAIL: '${ruleId}' should be class ${cls}, got '${entry?.class}'`);
  }
  console.log('PASS: RULES registry carries all five flow.cluster_* rule ids with the correct class');
}

console.log('\nAll flow-clusters-validate tests passed.');
