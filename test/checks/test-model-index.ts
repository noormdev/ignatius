/**
 * test-model-index.ts — unit tests for buildModelIndex.
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 * Tests the PUBLIC API only: calls buildModelIndex with plain Model literals
 * and validates the exported ModelIndex shape.
 */

import { buildModelIndex, type ModelIndex } from '../../src/model/model-index';
import type { Model, ModelNode, ModelEdge, SubtypeCluster, ColumnDef } from '../../src/model/parse';
import { defaultTheme } from '../../src/theme/theme-defaults';
import type { Branding } from '../../src/theme/branding-defaults';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Shared column definitions
const idCol: ColumnDef = { type: 'uuid' };
const nameCol: ColumnDef = { type: 'text', nullable: false };
const emailCol: ColumnDef = { type: 'text', nullable: true };
const orderIdCol: ColumnDef = { type: 'uuid' };
const amountCol: ColumnDef = { type: 'numeric' };

// Group A node (PK + AK + columns)
const customerNode: ModelNode = {
  id: 'Customer',
  classification: 'Independent',
  group: 'core',
  pk: ['id'],
  columns: { id: idCol, name: nameCol, email: emailCol },
  alternateKeys: [{ rule: 'unique_email', columns: ['email'] }],
  bodyHtml: '',
};

// Group A node (composite PK, no AK)
const orderNode: ModelNode = {
  id: 'Order',
  classification: 'Independent',
  group: 'core',
  pk: ['id'],
  columns: { id: idCol, customer_id: orderIdCol, amount: amountCol },
  alternateKeys: [],
  bodyHtml: '',
};

// Group B node
const productNode: ModelNode = {
  id: 'Product',
  classification: 'Independent',
  group: 'catalog',
  pk: ['sku'],
  columns: { sku: { type: 'text' }, price: { type: 'numeric' } },
  alternateKeys: [],
  bodyHtml: '',
};

// Ungrouped node
const auditNode: ModelNode = {
  id: 'AuditLog',
  classification: 'Dependent',
  pk: ['id'],
  columns: { id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

// Subtype nodes
const partyNode: ModelNode = {
  id: 'Party',
  classification: 'Independent',
  pk: ['party_id'],
  columns: { party_id: idCol, party_type: { type: 'text' } },
  alternateKeys: [],
  bodyHtml: '',
};

const personNode: ModelNode = {
  id: 'Person',
  classification: 'Subtype',
  pk: ['party_id'],
  columns: { party_id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

const orgNode: ModelNode = {
  id: 'Organization',
  classification: 'Subtype',
  pk: ['party_id'],
  columns: { party_id: idCol },
  alternateKeys: [],
  bodyHtml: '',
};

// A second basetype whose cluster also includes Person (multi-cluster member)
const accountNode: ModelNode = {
  id: 'Account',
  classification: 'Independent',
  pk: ['account_id'],
  columns: { account_id: idCol, account_type: { type: 'text' } },
  alternateKeys: [],
  bodyHtml: '',
};

// Edges
// Order → Customer (FK: customer_id → id)
const orderToCustomer: ModelEdge = {
  source: 'Order',
  target: 'Customer',
  identifying: false,
  on: { customer_id: 'id' },
  predicate: { fwd: 'placed by', rev: 'places' },
  cardinality: { parent: 'many', child: '1' },
};

// AuditLog → Order (FK: id → id)
const auditToOrder: ModelEdge = {
  source: 'AuditLog',
  target: 'Order',
  identifying: true,
  on: { id: 'id' },
  predicate: { fwd: 'logs', rev: 'logged by' },
  cardinality: { parent: 'many', child: '1' },
};

// Second edge from Order → Product (for multi-edge tests)
const orderToProduct: ModelEdge = {
  source: 'Order',
  target: 'Product',
  identifying: false,
  on: { product_sku: 'sku' },
  predicate: { fwd: 'includes', rev: 'included in' },
  cardinality: { parent: 'many', child: 'many' },
};

// Subtype clusters
const partyCluster: SubtypeCluster = {
  basetype: 'Party',
  exclusive: true,
  members: ['Person', 'Organization'],
  hasDiscriminator: true,
};

// Second cluster that also includes Person (multi-cluster member coverage)
const accountCluster: SubtypeCluster = {
  basetype: 'Account',
  exclusive: false,
  members: ['Person'],
  hasDiscriminator: false,
};

const testBranding: Branding = {
  logo: { dark: '', light: '' },
  title: 'Test',
  subtitle: '',
  copyright: { holder: 'Test', year: 2024 },
  poweredBy: false,
};

// Full model
const model: Model = {
  groups: {
    core: { label: 'Core', color: '#0000ff' },
    catalog: { label: 'Catalog', color: '#00ff00' },
  },
  nodes: [customerNode, orderNode, productNode, auditNode, partyNode, personNode, orgNode, accountNode],
  edges: [orderToCustomer, auditToOrder, orderToProduct],
  subtypeClusters: [partyCluster, accountCluster],
  theme: defaultTheme,
  branding: testBranding,
};

// ---------------------------------------------------------------------------
// Empty model — must not throw
// ---------------------------------------------------------------------------

const emptyModel: Model = {
  groups: {},
  nodes: [],
  edges: [],
  subtypeClusters: [],
  theme: defaultTheme,
  branding: testBranding,
};

const emptyIndex: ModelIndex = buildModelIndex(emptyModel);
assert(emptyIndex.nodeById.size === 0, 'empty: nodeById is empty');
assert(emptyIndex.nodeIdSet.size === 0, 'empty: nodeIdSet is empty');
assert(emptyIndex.edgesBySource.size === 0, 'empty: edgesBySource is empty');
assert(emptyIndex.edgesByTarget.size === 0, 'empty: edgesByTarget is empty');
assert(emptyIndex.edgeByEndpointPair.size === 0, 'empty: edgeByEndpointPair is empty');
assert(emptyIndex.pkByNode.size === 0, 'empty: pkByNode is empty');
assert(emptyIndex.columnsByNode.size === 0, 'empty: columnsByNode is empty');
assert(emptyIndex.akColumnsByNode.size === 0, 'empty: akColumnsByNode is empty');
assert(emptyIndex.fkColumnsByNode.size === 0, 'empty: fkColumnsByNode is empty');
assert(emptyIndex.subtypeMemberToCluster.size === 0, 'empty: subtypeMemberToCluster is empty');
assert(emptyIndex.clustersByMemberId.size === 0, 'empty: clustersByMemberId is empty');
assert(emptyIndex.basetypeClusterById.size === 0, 'empty: basetypeClusterById is empty');
assert(emptyIndex.nodesByGroup.size === 0, 'empty: nodesByGroup is empty');
console.log('PASS: empty model returns empty maps without throwing');

// ---------------------------------------------------------------------------
// Build the full index
// ---------------------------------------------------------------------------

const idx: ModelIndex = buildModelIndex(model);

// ---------------------------------------------------------------------------
// nodeById / nodeIdSet
// ---------------------------------------------------------------------------

assert(idx.nodeById.size === 8, `nodeById: expected 8 entries, got ${idx.nodeById.size}`);
assert(idx.nodeById.get('Customer') === customerNode, 'nodeById: Customer resolves to customerNode');
assert(idx.nodeById.get('Order') === orderNode, 'nodeById: Order resolves to orderNode');
assert(idx.nodeById.get('AuditLog') === auditNode, 'nodeById: AuditLog resolves to auditNode');

assert(idx.nodeIdSet.size === 8, `nodeIdSet: expected 8, got ${idx.nodeIdSet.size}`);
assert(idx.nodeIdSet.has('Customer'), 'nodeIdSet: has Customer');
assert(idx.nodeIdSet.has('Product'), 'nodeIdSet: has Product');
assert(!idx.nodeIdSet.has('Ghost'), 'nodeIdSet: does not have Ghost');
console.log('PASS: nodeById / nodeIdSet');

// ---------------------------------------------------------------------------
// edgesBySource / edgesByTarget
// ---------------------------------------------------------------------------

// Order has two outgoing edges
const orderSourceEdges = idx.edgesBySource.get('Order');
assert(orderSourceEdges !== undefined, 'edgesBySource: Order has entries');
assert(orderSourceEdges.length === 2, `edgesBySource: Order has 2 edges, got ${orderSourceEdges?.length}`);
assert(orderSourceEdges.includes(orderToCustomer), 'edgesBySource: Order includes orderToCustomer');
assert(orderSourceEdges.includes(orderToProduct), 'edgesBySource: Order includes orderToProduct');

// AuditLog has one outgoing edge
const auditSourceEdges = idx.edgesBySource.get('AuditLog');
assert(auditSourceEdges !== undefined, 'edgesBySource: AuditLog has entries');
assert(auditSourceEdges.length === 1, `edgesBySource: AuditLog has 1 edge, got ${auditSourceEdges?.length}`);
assert(auditSourceEdges[0] === auditToOrder, 'edgesBySource: AuditLog[0] === auditToOrder');

// Customer has one incoming edge
const customerTargetEdges = idx.edgesByTarget.get('Customer');
assert(customerTargetEdges !== undefined, 'edgesByTarget: Customer has entries');
assert(customerTargetEdges.length === 1, `edgesByTarget: Customer has 1 edge, got ${customerTargetEdges?.length}`);
assert(customerTargetEdges[0] === orderToCustomer, 'edgesByTarget: Customer[0] === orderToCustomer');

// Order has one incoming edge (from AuditLog)
const orderTargetEdges = idx.edgesByTarget.get('Order');
assert(orderTargetEdges !== undefined, 'edgesByTarget: Order has entries');
assert(orderTargetEdges.length === 1, `edgesByTarget: Order has 1 edge, got ${orderTargetEdges?.length}`);
assert(orderTargetEdges[0] === auditToOrder, 'edgesByTarget: Order[0] === auditToOrder');

// Node with no edges is absent
assert(idx.edgesBySource.get('Customer') === undefined, 'edgesBySource: Customer absent (no outgoing)');
console.log('PASS: edgesBySource / edgesByTarget');

// ---------------------------------------------------------------------------
// edgeByEndpointPair
// ---------------------------------------------------------------------------

const o2cEdge = idx.edgeByEndpointPair.get('Order>Customer');
assert(o2cEdge === orderToCustomer, 'edgeByEndpointPair: Order>Customer resolves to orderToCustomer');

const a2oEdge = idx.edgeByEndpointPair.get('AuditLog>Order');
assert(a2oEdge === auditToOrder, 'edgeByEndpointPair: AuditLog>Order resolves to auditToOrder');

const o2pEdge = idx.edgeByEndpointPair.get('Order>Product');
assert(o2pEdge === orderToProduct, 'edgeByEndpointPair: Order>Product resolves to orderToProduct');

assert(idx.edgeByEndpointPair.get('Ghost>Customer') === undefined, 'edgeByEndpointPair: unknown key is undefined');
assert(idx.edgeByEndpointPair.size === 3, `edgeByEndpointPair: size === 3, got ${idx.edgeByEndpointPair.size}`);
console.log('PASS: edgeByEndpointPair');

// ---------------------------------------------------------------------------
// pkByNode
// ---------------------------------------------------------------------------

const customerPk = idx.pkByNode.get('Customer');
assert(customerPk !== undefined, 'pkByNode: Customer has entry');
assert(customerPk.length === 1, `pkByNode: Customer pk length === 1, got ${customerPk?.length}`);
assert(customerPk[0] === 'id', `pkByNode: Customer pk[0] === 'id', got ${customerPk?.[0]}`);

const productPk = idx.pkByNode.get('Product');
assert(productPk !== undefined, 'pkByNode: Product has entry');
assert(productPk[0] === 'sku', `pkByNode: Product pk[0] === 'sku', got ${productPk?.[0]}`);
console.log('PASS: pkByNode');

// ---------------------------------------------------------------------------
// columnsByNode
// ---------------------------------------------------------------------------

const customerCols = idx.columnsByNode.get('Customer');
assert(customerCols !== undefined, 'columnsByNode: Customer has entry');
assert('email' in customerCols, 'columnsByNode: Customer has email column');
assert(customerCols['email'] === emailCol, 'columnsByNode: Customer email column matches fixture');
assert('name' in customerCols, 'columnsByNode: Customer has name column');
console.log('PASS: columnsByNode');

// ---------------------------------------------------------------------------
// akColumnsByNode
// ---------------------------------------------------------------------------

const customerAkCols = idx.akColumnsByNode.get('Customer');
assert(customerAkCols !== undefined, 'akColumnsByNode: Customer has entry');
assert(customerAkCols.has('email'), "akColumnsByNode: Customer AK includes 'email'");

// Order has no AK
const orderAkCols = idx.akColumnsByNode.get('Order');
assert(orderAkCols === undefined || orderAkCols.size === 0, 'akColumnsByNode: Order has no AK columns');
console.log('PASS: akColumnsByNode');

// ---------------------------------------------------------------------------
// fkColumnsByNode
// ---------------------------------------------------------------------------

// Order has FK columns: customer_id (from orderToCustomer) + product_sku (from orderToProduct)
const orderFkCols = idx.fkColumnsByNode.get('Order');
assert(orderFkCols !== undefined, 'fkColumnsByNode: Order has entry');
assert(orderFkCols.has('customer_id'), "fkColumnsByNode: Order has 'customer_id'");
assert(orderFkCols.has('product_sku'), "fkColumnsByNode: Order has 'product_sku'");

// AuditLog has FK column: id (from auditToOrder)
const auditFkCols = idx.fkColumnsByNode.get('AuditLog');
assert(auditFkCols !== undefined, 'fkColumnsByNode: AuditLog has entry');
assert(auditFkCols.has('id'), "fkColumnsByNode: AuditLog has 'id'");

// Customer has no FK columns (it is only a target)
const customerFkCols = idx.fkColumnsByNode.get('Customer');
assert(customerFkCols === undefined || customerFkCols.size === 0, 'fkColumnsByNode: Customer has no FK cols');
console.log('PASS: fkColumnsByNode');

// ---------------------------------------------------------------------------
// subtypeMemberToCluster
// ---------------------------------------------------------------------------

// subtypeMemberToCluster: member → ONE cluster (the first for that member; see clustersByMemberId for all)
const personCluster = idx.subtypeMemberToCluster.get('Person');
assert(personCluster !== undefined, 'subtypeMemberToCluster: Person has entry');
// Person appears in both partyCluster and accountCluster; subtypeMemberToCluster points to one of them
assert(
  personCluster === partyCluster || personCluster === accountCluster,
  'subtypeMemberToCluster: Person points to a known cluster',
);

const orgCluster = idx.subtypeMemberToCluster.get('Organization');
assert(orgCluster === partyCluster, 'subtypeMemberToCluster: Organization → partyCluster');

// Basetype itself is not a member
assert(idx.subtypeMemberToCluster.get('Party') === undefined, 'subtypeMemberToCluster: Party (basetype) is absent');
console.log('PASS: subtypeMemberToCluster');

// ---------------------------------------------------------------------------
// clustersByMemberId (array; multi-cluster member)
// ---------------------------------------------------------------------------

const personClusters = idx.clustersByMemberId.get('Person');
assert(personClusters !== undefined, 'clustersByMemberId: Person has entries');
assert(personClusters.length === 2, `clustersByMemberId: Person in 2 clusters, got ${personClusters?.length}`);
assert(personClusters.includes(partyCluster), 'clustersByMemberId: Person includes partyCluster');
assert(personClusters.includes(accountCluster), 'clustersByMemberId: Person includes accountCluster');

const orgClusters = idx.clustersByMemberId.get('Organization');
assert(orgClusters !== undefined, 'clustersByMemberId: Organization has entries');
assert(orgClusters.length === 1, `clustersByMemberId: Organization in 1 cluster, got ${orgClusters?.length}`);
assert(orgClusters[0] === partyCluster, 'clustersByMemberId: Organization[0] === partyCluster');
console.log('PASS: clustersByMemberId (including multi-cluster member)');

// ---------------------------------------------------------------------------
// basetypeClusterById
// ---------------------------------------------------------------------------

assert(idx.basetypeClusterById.get('Party') === partyCluster, 'basetypeClusterById: Party → partyCluster');
assert(idx.basetypeClusterById.get('Account') === accountCluster, 'basetypeClusterById: Account → accountCluster');
assert(idx.basetypeClusterById.get('Person') === undefined, 'basetypeClusterById: Person (member) is absent');
console.log('PASS: basetypeClusterById');

// ---------------------------------------------------------------------------
// nodesByGroup
// ---------------------------------------------------------------------------

const coreNodes = idx.nodesByGroup.get('core');
assert(coreNodes !== undefined, "nodesByGroup: 'core' has entries");
assert(coreNodes.length === 2, `nodesByGroup: 'core' has 2 nodes, got ${coreNodes?.length}`);
assert(coreNodes.includes(customerNode), "nodesByGroup: 'core' includes customerNode");
assert(coreNodes.includes(orderNode), "nodesByGroup: 'core' includes orderNode");

const catalogNodes = idx.nodesByGroup.get('catalog');
assert(catalogNodes !== undefined, "nodesByGroup: 'catalog' has entries");
assert(catalogNodes.length === 1, `nodesByGroup: 'catalog' has 1 node, got ${catalogNodes?.length}`);
assert(catalogNodes[0] === productNode, "nodesByGroup: 'catalog'[0] === productNode");

// Ungrouped node (AuditLog has no group) must not appear in any group bucket
for (const [, groupNodes] of idx.nodesByGroup) {
  assert(!groupNodes.includes(auditNode), 'nodesByGroup: auditNode (ungrouped) absent from all buckets');
}
console.log('PASS: nodesByGroup');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\nAll buildModelIndex assertions passed.');
