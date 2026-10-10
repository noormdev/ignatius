/** WHY: a missed item hides an edit from the reviewer; a spurious one (key or column reorder) trains them to ignore highlights.
 *  Coverage rows follow docs/spec/model-change-review.md. */

import {
  crossCheck,
  diffSnapshots,
  parseChangeNote,
  type ChangeItem,
  type ChangeNote,
  type ChangeReview,
  type ModelSnapshot,
} from '../../src/model/change-review';
import { parseModels, type ModelEdge, type ModelNode } from '../../src/model/parse';
import type { FlowDiagram, FlowEdge, FlowEndpoint, FlowProcess, FlowStoreRef } from '../../src/flows/flow-parse';
import { CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID, deriveLevels } from '../../src/flows/flow-derive-levels';
import { defaultTheme } from '../../src/theme/theme-defaults';
import { defaultBranding } from '../../src/theme/branding-defaults';
import { itemLabel } from '../../src/app/components/changes/ChangesPanel';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`PASS: ${name}`);
    return;
  }
  failures++;
  console.error(`FAIL: ${name}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
}

function node(id: string, over: Partial<ModelNode> = {}): ModelNode {
  return {
    id,
    classification: 'Independent',
    group: 'core',
    pk: [`${id.toLowerCase()}_id`],
    columns: {
      [`${id.toLowerCase()}_id`]: { type: 'int' },
      name: { type: 'text', nullable: false, desc: 'Display name' },
    },
    alternateKeys: [{ rule: 'name is unique', columns: ['name'] }],
    bodyHtml: `<p>${id} body</p>\n`,
    description: `${id} description`,
    examples: [{ [`${id.toLowerCase()}_id`]: 1, name: 'one' }],
    ...over,
  };
}

function edge(source: string, target: string, over: Partial<ModelEdge> = {}): ModelEdge {
  return {
    source,
    target,
    identifying: false,
    on: { [`${target.toLowerCase()}_id`]: `${target.toLowerCase()}_id` },
    predicate: { fwd: 'is billed to', rev: 'is billed for' },
    cardinality: { parent: '1', child: 'many' },
    ...over,
  };
}

function endpoint(raw: string): FlowEndpoint {
  const [kind = '', name = ''] = raw.split(':');
  return { kind: kind === 'ext' ? 'ext' : kind === 'db' ? 'db' : 'proc', name, raw };
}

function flowEdge(from: string, to: string, flowId: string): FlowEdge {
  return { from: endpoint(from), to: endpoint(to), data: 'order', flowId };
}

function proc(id: string, flowId: string, over: Partial<FlowProcess> = {}): FlowProcess {
  return {
    id,
    label: id,
    dottedNumber: '1',
    inputs: [flowEdge('ext:Customer', `proc:${id}`, flowId)],
    outputs: [flowEdge(`proc:${id}`, 'db:Invoice', flowId)],
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId,
    ...over,
  };
}

function diagram(id: string, over: Partial<FlowDiagram> = {}): FlowDiagram {
  return {
    id,
    title: id,
    processes: [proc('bill-customer', id)],
    externals: [{ id: 'Customer', label: 'Customer', body: '', bodyHtml: '', flowId: id }],
    storeRefs: [{ kind: 'db', name: 'Invoice', displayName: 'Invoice', flowId: id }],
    edges: [],
    subDfds: [],
    ...over,
  };
}

function snapshot(nodes: ModelNode[], edges: ModelEdge[], flows: FlowDiagram[] = []): ModelSnapshot {
  return {
    version: 1,
    model: { groups: {}, nodes, edges, subtypeClusters: [], theme: defaultTheme, branding: defaultBranding },
    flows,
  };
}

function base(): ModelSnapshot {
  return snapshot(
    [node('Customer'), node('Invoice')],
    [edge('Invoice', 'Customer')],
    [diagram('order-to-cash')],
  );
}

function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture has no index ${index}`);
  return value;
}

function only(items: ChangeItem[]): ChangeItem | undefined {
  return items.length === 1 ? items[0] : undefined;
}

check('identical snapshots produce no items', diffSnapshots(base(), base()).length === 0);

{
  const current = base();
  const invoice = at(current.model.nodes, 1);
  invoice.columns = { name: { desc: 'Display name', nullable: false, type: 'text' }, invoice_id: { type: 'int' } };
  invoice.examples = [{ name: 'one', invoice_id: 1 }];
  current.model.nodes.reverse();
  current.model.edges[0] = { ...edge('Invoice', 'Customer'), predicate: { rev: 'is billed for', fwd: 'is billed to' } };
  const billCustomer = at(at(current.flows, 0).processes, 0);
  billCustomer.inputs = [...billCustomer.inputs].reverse();
  const items = diffSnapshots(base(), current);
  check('reordered keys, columns, nodes, and examples produce no items', items.length === 0, items);
}

{
  const current = base();
  current.model.nodes.push(node('Payment'));
  const item = only(diffSnapshots(base(), current));
  check('added entity yields one entity item', item?.scope === 'entity' && item.kind === 'added' && item.entity === 'Payment', item);
}

{
  const current = base();
  current.model.nodes = current.model.nodes.filter(n => n.id !== 'Invoice');
  current.model.edges = [];
  const items = diffSnapshots(base(), current);
  check(
    'removed entity yields an entity item and its relationship item',
    items.length === 2
      && items.some(i => i.scope === 'entity' && i.kind === 'removed' && i.entity === 'Invoice')
      && items.some(i => i.scope === 'relationship' && i.kind === 'removed' && i.source === 'Invoice'),
    items,
  );
}

{
  const current = base();
  const invoice = at(current.model.nodes, 1);
  invoice.group = 'billing';
  invoice.description = 'Changed';
  invoice.classification = 'Dependent';
  invoice.examples = [{ invoice_id: 2, name: 'two' }];
  const item = only(diffSnapshots(base(), current));
  const fields = item?.scope === 'entity' ? [...(item.fields ?? [])].sort() : [];
  check(
    'entity attribute changes yield one changed entity item naming the fields',
    item?.scope === 'entity' && item.kind === 'changed'
      && JSON.stringify(fields) === JSON.stringify(['classification', 'description', 'examples', 'group']),
    item,
  );
}

{
  const current = base();
  at(current.model.nodes, 1).pk = ['invoice_id', 'name'];
  const item = only(diffSnapshots(base(), current));
  check('PK membership change names pk', item?.scope === 'entity' && JSON.stringify(item.fields) === '["pk"]', item);
}

{
  const current = base();
  at(current.model.nodes, 1).alternateKeys = [{ rule: 'name is unique', columns: ['name', 'invoice_id'] }];
  const item = only(diffSnapshots(base(), current));
  check('AK membership change names ak', item?.scope === 'entity' && JSON.stringify(item.fields) === '["ak"]', item);
}

{
  const keyed = (pk: string[], aks: ModelNode['alternateKeys'], members: string[]) => {
    const s = base();
    const invoice = at(s.model.nodes, 1);
    invoice.pk = pk;
    invoice.alternateKeys = aks;
    s.model.subtypeClusters = [{ basetype: 'Invoice', exclusive: true, members, hasDiscriminator: true }];
    return s;
  };
  const before = keyed(
    ['invoice_id', 'name'],
    [{ rule: 'number is unique', columns: ['series', 'number'] }, { rule: 'name is unique', columns: ['name'] }],
    ['CreditNote', 'DebitNote'],
  );
  const after = keyed(
    ['name', 'invoice_id'],
    [{ rule: 'name is unique', columns: ['name'] }, { rule: 'number is unique', columns: ['number', 'series'] }],
    ['DebitNote', 'CreditNote'],
  );
  const items = diffSnapshots(before, after);
  check('reordered PK members, AKs, AK members, and subtype members produce no items', items.length === 0, items);
}

{
  const before = base();
  before.model.subtypeClusters = [{ basetype: 'Invoice', exclusive: true, members: ['CreditNote'], hasDiscriminator: true }];
  const after = base();
  after.model.subtypeClusters = [{ basetype: 'Invoice', exclusive: false, members: ['CreditNote', 'DebitNote'], hasDiscriminator: true }];
  const item = only(diffSnapshots(before, after));
  check(
    'subtype cluster change on a basetype names subtypes',
    item?.scope === 'entity' && item.kind === 'changed' && item.entity === 'Invoice' && JSON.stringify(item.fields) === '["subtypes"]',
    item,
  );
}

{
  const before = base();
  before.model.subtypeClusters = [{ basetype: 'Invoice', exclusive: true, members: ['CreditNote'], hasDiscriminator: false }];
  const after = base();
  after.model.subtypeClusters = [{ basetype: 'Invoice', exclusive: true, members: ['CreditNote'], hasDiscriminator: true }];
  const item = only(diffSnapshots(before, after));
  check(
    'switching subtype members from list form to object form names subtypes',
    item?.scope === 'entity' && item.kind === 'changed' && JSON.stringify(item.fields) === '["subtypes"]',
    item,
  );
}

{
  const current = base();
  at(current.model.nodes, 1).singleton = true;
  const item = only(diffSnapshots(base(), current));
  check('marking an entity singleton names singleton', item?.scope === 'entity' && JSON.stringify(item.fields) === '["singleton"]', item);
}

{
  const current = base();
  at(current.model.nodes, 1).singleton = false;
  const items = diffSnapshots(base(), current);
  check('singleton absent and false are the same', items.length === 0, items);
}

{
  const current = base();
  at(current.model.nodes, 1).columns.line_total = { type: 'numeric' };
  const item = only(diffSnapshots(base(), current));
  check(
    'added column yields a column item',
    item?.scope === 'column' && item.kind === 'added' && item.entity === 'Invoice' && item.column === 'line_total',
    item,
  );
}

{
  const current = base();
  delete at(current.model.nodes, 1).columns.name;
  const item = only(diffSnapshots(base(), current));
  check('removed column yields a column item', item?.scope === 'column' && item.kind === 'removed' && item.column === 'name', item);
  // The Dictionary draws the removed row from this; the current model no longer has it.
  check(
    'removed column carries its baseline definition',
    item?.scope === 'column' && item.def?.type === 'text' && item.def.desc === 'Display name',
    item,
  );
}

{
  const current = base();
  at(current.model.nodes, 1).columns.name = { type: 'varchar', nullable: true, default: "''", desc: 'Name' };
  const item = only(diffSnapshots(base(), current));
  const fields = item?.scope === 'column' ? [...(item.fields ?? [])].sort() : [];
  check(
    'changed column names type, nullable, default, desc',
    item?.scope === 'column' && item.kind === 'changed'
      && JSON.stringify(fields) === JSON.stringify(['default', 'desc', 'nullable', 'type']),
    item,
  );
}

{
  const current = base();
  current.model.edges.push(edge('Customer', 'Invoice'));
  const item = only(diffSnapshots(base(), current));
  check(
    'added relationship keyed by source and target',
    item?.scope === 'relationship' && item.kind === 'added' && item.source === 'Customer' && item.target === 'Invoice',
    item,
  );
}

{
  const current = base();
  current.model.edges[0] = edge('Invoice', 'Customer', {
    identifying: true,
    on: { owner_id: 'customer_id' },
    predicate: { fwd: 'is owed by', rev: 'owes' },
    cardinality: { parent: '1', child: '1' },
  });
  const item = only(diffSnapshots(base(), current));
  const fields = item?.scope === 'relationship' ? [...(item.fields ?? [])].sort() : [];
  check(
    'changed relationship names identifying, on, predicate, cardinality',
    item?.scope === 'relationship' && item.kind === 'changed'
      && JSON.stringify(fields) === JSON.stringify(['cardinality', 'identifying', 'on', 'predicate']),
    item,
  );
}

{
  const dual = (fwd: string) => [
    edge('Transition', 'Status', { on: { from_status: 'status_id' } }),
    edge('Transition', 'Status', { on: { to_status: 'status_id' }, predicate: { fwd, rev: 'is entered by' } }),
  ];
  const before = snapshot([node('Status'), node('Transition')], dual('enters'));
  const after = snapshot([node('Status'), node('Transition')], dual('leads to'));
  const item = only(diffSnapshots(before, after));
  check(
    'two edges sharing source and target are diffed separately',
    item?.scope === 'relationship' && item.kind === 'changed' && JSON.stringify(item.on) === '{"to_status":"status_id"}',
    item,
  );
  after.model.edges.pop();
  const removed = diffSnapshots(before, after);
  const r = crossCheck(removed, [], before.model);
  check(
    'removing one of two edges sharing source and target ghosts only that edge',
    r.removedEdges.length === 1 && JSON.stringify(r.removedEdges[0]?.on) === '{"to_status":"status_id"}',
    r,
  );
}

{
  const current = base();
  at(current.model.nodes, 1).bodyHtml = '<p>Rewritten</p>\n';
  const item = only(diffSnapshots(base(), current));
  check('body-only change yields a doc item', item?.scope === 'doc' && item.entity === 'Invoice', item);
}

{
  const current = base();
  current.flows.push(diagram('procure-to-pay'));
  const item = only(diffSnapshots(base(), current));
  check(
    'added diagram yields one flow item without a node',
    item?.scope === 'flow' && item.kind === 'added' && item.diagram === 'procure-to-pay' && item.node === undefined,
    item,
  );
}

{
  const current = base();
  current.flows = [];
  const item = only(diffSnapshots(base(), current));
  check('removed diagram yields one flow item', item?.scope === 'flow' && item.kind === 'removed' && item.diagram === 'order-to-cash', item);
}

{
  const current = base();
  at(current.flows, 0).processes.push(proc('collect-payment', 'order-to-cash'));
  at(current.flows, 0).externals.push({ id: 'Bank', label: 'Bank', body: '', bodyHtml: '', flowId: 'order-to-cash' });
  at(current.flows, 0).storeRefs.push({ kind: 'db', name: 'Payment', displayName: 'Payment', flowId: 'order-to-cash' });
  const items = diffSnapshots(base(), current);
  const nodes = items.flatMap(i => (i.scope === 'flow' && i.kind === 'added' ? [`${i.nodeKind}:${i.node}`] : [])).sort();
  check(
    'added process, external, and store yield node flow items',
    items.length === 3 && JSON.stringify(nodes) === JSON.stringify(['external:Bank', 'process:collect-payment', 'store:Payment']),
    items,
  );
}

{
  const current = base();
  const billCustomer = at(at(current.flows, 0).processes, 0);
  billCustomer.label = 'Bill the customer';
  billCustomer.outputs = [flowEdge('proc:bill-customer', 'db:Receipt', 'order-to-cash')];
  at(at(current.flows, 0).externals, 0).description = 'Buyer';
  at(current.flows, 0).storeRefs = [];
  const items = diffSnapshots(base(), current);
  const changedProcess = items.find(i => i.scope === 'flow' && i.node === 'bill-customer');
  check(
    'changed process names label and outputs',
    changedProcess?.scope === 'flow' && changedProcess.kind === 'changed'
      && JSON.stringify([...(changedProcess.fields ?? [])].sort()) === JSON.stringify(['label', 'outputs']),
    items,
  );
  check('changed external yields a changed flow item', items.some(i => i.scope === 'flow' && i.kind === 'changed' && i.node === 'Customer'), items);
  check('removed store yields a removed flow item', items.some(i => i.scope === 'flow' && i.kind === 'removed' && i.node === 'Invoice'), items);
}

{
  const sub = diagram('bill-customer', { processes: [proc('issue-invoice', 'bill-customer')] });
  const before = base();
  at(before.flows, 0).subDfds = [sub];
  const after = base();
  at(after.flows, 0).subDfds = [diagram('bill-customer', { processes: [proc('issue-invoice', 'bill-customer', { label: 'Issue' })] })];
  const item = only(diffSnapshots(before, after));
  check(
    'nested sub-DFD changes are found',
    item?.scope === 'flow' && item.kind === 'changed' && item.diagram === 'bill-customer'
      && item.diagramPath === 'order-to-cash/bill-customer' && item.node === 'issue-invoice',
    item,
  );
}

{
  const parents = (label: string) => [
    diagram('order-to-cash', { subDfds: [diagram('detail', { processes: [proc('step', 'detail', { label })] })] }),
    diagram('procure-to-pay', { subDfds: [diagram('detail', { processes: [proc('step', 'detail', { label })] })] }),
  ];
  const items = diffSnapshots(snapshot([], [], parents('Step')), snapshot([], [], parents('Renamed')));
  const paths = items.flatMap(i => (i.scope === 'flow' && i.diagram === 'detail' ? [i.diagramPath] : [])).sort();
  check(
    'sub-DFDs sharing an id under different parents are diffed separately',
    items.length === 2 && JSON.stringify(paths) === JSON.stringify(['order-to-cash/detail', 'procure-to-pay/detail']),
    items,
  );
}

{
  const leveled = (leaf: FlowDiagram) =>
    deriveLevels({ diagrams: [leaf], modelDir: '', externals: [], clusters: [] }).diagrams;
  const after = diagram('order-to-cash');
  after.externals.push({ id: 'Bank', label: 'Bank', body: '', bodyHtml: '', flowId: 'order-to-cash' });
  after.storeRefs.push({ kind: 'db', name: 'Payment', displayName: 'Payment', flowId: 'order-to-cash' });
  const items = diffSnapshots(snapshot([], [], leveled(diagram('order-to-cash'))), snapshot([], [], leveled(after)));
  const r = review(items, [note('a.md', {}, { 'order-to-cash': ['Bank', 'Payment'] })]);
  check(
    'derived context and L1 diagrams yield no items a note cannot name',
    items.length > 0 && r.items.every(i => i.status === 'explained') && r.claims.length === 0,
    items,
  );
  check(
    'leaf items keep the derived ancestors in diagramPath',
    items.every(i => i.scope === 'flow' && i.diagramPath === `${CONTEXT_DIAGRAM_ID}/${SYSTEM_PROCESS_ID}/order-to-cash`),
    items,
  );
}

{
  const stores = (): FlowStoreRef[] => [
    { kind: 'db', name: 'orders', displayName: 'orders', flowId: 'order-to-cash' },
    { kind: 'cache', name: 'orders', displayName: 'orders', flowId: 'order-to-cash' },
  ];
  const before = snapshot([], [], [diagram('order-to-cash', { storeRefs: stores() })]);
  const after = snapshot([], [], [diagram('order-to-cash', { storeRefs: stores().slice(0, 1) })]);
  const item = only(diffSnapshots(before, after));
  check(
    'stores sharing a name across kinds are keyed apart',
    item?.scope === 'flow' && item.kind === 'removed' && item.node === 'orders' && item.nodeKind === 'store',
    item,
  );
  // The Flow view highlights a store by `kind:name`; the name alone would also light `db:orders`.
  check('a store item carries its kind', item?.scope === 'flow' && item.storeKind === 'cache', item);
}

{
  const current = base();
  const billCustomer = at(at(current.flows, 0).processes, 0);
  billCustomer.inputs = [{ ...flowEdge('ext:Customer', 'proc:bill-customer', 'order-to-cash'), from: { kind: 'ext', name: 'Customer', raw: 'Customer' } }];
  const items = diffSnapshots(base(), current);
  check('a flow endpoint spelled differently but resolving to the same node is no change', items.length === 0, items);
}

{
  const withData = (data: string[]) => {
    const s = base();
    at(at(s.flows, 0).processes, 0).outputs = [{ ...flowEdge('proc:bill-customer', 'db:Invoice', 'order-to-cash'), data }];
    return s;
  };
  const items = diffSnapshots(withData(['invoice', 'line']), withData(['line', 'invoice']));
  check('reordered flow edge data items produce no items', items.length === 0, items);
}

const noteText = `---
title: Split invoice lines out of Invoice
entities:
  Invoice: [line_total]
  InvoiceLine:
flows:
  order-to-cash: [bill-customer]
---

Lines need their own **tax** rate.
`;

const parsed = parseChangeNote('split-invoice-lines.md', noteText);
check(
  'parseChangeNote reads title, entities, flows, and renders the body',
  'title' in parsed
    && parsed.file === 'split-invoice-lines.md'
    && parsed.title === 'Split invoice lines out of Invoice'
    && JSON.stringify(parsed.entities) === JSON.stringify({ Invoice: ['line_total'], InvoiceLine: [] })
    && JSON.stringify(parsed.flows) === JSON.stringify({ 'order-to-cash': ['bill-customer'] })
    && parsed.bodyHtml.includes('<strong>tax</strong>'),
  parsed,
);

{
  const result = parseChangeNote('bare.md', '---\ntitle: Only a title\n---');
  check(
    'parseChangeNote accepts a note with neither entities, flows, nor body',
    'title' in result && Object.keys(result.entities).length === 0 && Object.keys(result.flows).length === 0,
    result,
  );
}

for (const [label, text] of [
  ['no frontmatter', 'Just prose.'],
  ['invalid YAML', '---\ntitle: [unclosed\n---\nbody'],
  ['entities is a list', '---\ntitle: T\nentities: [Invoice]\n---\n'],
  ['column list holds a mapping', '---\ntitle: T\nentities:\n  Invoice: [{a: 1}]\n---\n'],
  ['title is not a string', '---\ntitle: [a, b]\n---\n'],
] satisfies [string, string][]) {
  const result = parseChangeNote('bad.md', text);
  check(`parseChangeNote returns an error for ${label}`, 'error' in result && result.file === 'bad.md', result);
}

function note(file: string, entities: Record<string, string[]>, flows: Record<string, string[]> = {}): ChangeNote {
  return { file, title: file, entities, flows, bodyHtml: '' };
}

function review(items: ChangeItem[], notes: ChangeNote[], baseline = base()): ChangeReview {
  return crossCheck(items, notes, baseline.model);
}

function statusOf(r: ChangeReview): string[] {
  return r.items.map(i => `${i.status}:${i.notes.join(',')}`);
}

const coverageRows: { row: string; item: ChangeItem; covering: ChangeNote; silent: ChangeNote }[] = [
  {
    row: 'entity',
    item: { scope: 'entity', kind: 'changed', entity: 'Invoice', fields: ['group'] },
    covering: note('a.md', { Invoice: [] }),
    silent: note('b.md', { Customer: [] }),
  },
  {
    row: 'column',
    item: { scope: 'column', kind: 'added', entity: 'Invoice', column: 'line_total' },
    covering: note('a.md', { Invoice: ['line_total'] }),
    silent: note('b.md', { Invoice: ['name'] }),
  },
  {
    row: 'relationship by source',
    item: { scope: 'relationship', kind: 'added', source: 'Invoice', target: 'Customer', on: { customer_id: 'customer_id' } },
    covering: note('a.md', { Invoice: [] }),
    silent: note('b.md', { Payment: [] }),
  },
  {
    row: 'relationship by target',
    item: { scope: 'relationship', kind: 'added', source: 'Invoice', target: 'Customer', on: { customer_id: 'customer_id' } },
    covering: note('a.md', { Customer: [] }),
    silent: note('b.md', { Payment: [] }),
  },
  {
    row: 'doc',
    item: { scope: 'doc', kind: 'changed', entity: 'Invoice' },
    covering: note('a.md', { Invoice: [] }),
    silent: note('b.md', {}, { 'order-to-cash': [] }),
  },
  {
    row: 'flow diagram',
    item: { scope: 'flow', kind: 'added', diagram: 'procure-to-pay', diagramPath: 'procure-to-pay' },
    covering: note('a.md', {}, { 'procure-to-pay': [] }),
    silent: note('b.md', {}, { 'order-to-cash': [] }),
  },
  {
    row: 'flow node',
    item: { scope: 'flow', kind: 'changed', diagram: 'order-to-cash', diagramPath: 'order-to-cash', node: 'bill-customer', nodeKind: 'process' },
    covering: note('a.md', {}, { 'order-to-cash': ['bill-customer'] }),
    silent: note('b.md', {}, { 'order-to-cash': [] }),
  },
];

for (const { row, item, covering, silent } of coverageRows) {
  check(`coverage ${row}: covering note explains`, JSON.stringify(statusOf(review([item], [covering]))) === '["explained:a.md"]');
  check(`coverage ${row}: non-covering note leaves it unexplained`, JSON.stringify(statusOf(review([item], [silent]))) === '["unexplained:"]');
}

{
  const item: ChangeItem = { scope: 'column', kind: 'added', entity: 'constructor', column: 'name' };
  const r = review([item], [note('a.md', { Invoice: [] })]);
  check('an entity named like an Object prototype key is not covered by accident', JSON.stringify(statusOf(r)) === '["unexplained:"]', r.items);
}

{
  const item: ChangeItem = { scope: 'entity', kind: 'changed', entity: 'Invoice', fields: ['group'] };
  const r = review([item], [note('a.md', { Invoice: [] }), note('b.md', { Invoice: ['name'] })]);
  check('an item covered by two notes lists both files', JSON.stringify(statusOf(r)) === '["explained:a.md,b.md"]', r.items);
}

{
  const items: ChangeItem[] = [
    { scope: 'column', kind: 'added', entity: 'Invoice', column: 'line_total' },
    { scope: 'flow', kind: 'changed', diagram: 'order-to-cash', diagramPath: 'order-to-cash', node: 'bill-customer', nodeKind: 'process' },
    { scope: 'entity', kind: 'added', entity: 'InvoiceLine' },
  ];
  const r = review(items, [
    note('a.md', { Invoice: ['line_total', 'name'], Payment: [], InvoiceLine: ['qty'] }, {
      'order-to-cash': ['bill-customer', 'ship-order'],
      'procure-to-pay': [],
    }),
  ]);
  const claims = r.claims.map(c => ('entity' in c ? `entity:${c.entity}/${c.column ?? ''}` : `flow:${c.diagram}/${c.node ?? ''}`)).sort();
  check(
    'claims list unchanged entities, columns, diagrams, and nodes',
    JSON.stringify(claims) === JSON.stringify([
      'entity:Invoice/name',
      'entity:Payment/',
      'flow:order-to-cash/ship-order',
      'flow:procure-to-pay/',
    ]) && r.claims.every(c => c.note === 'a.md'),
    r.claims,
  );
}

{
  const items: ChangeItem[] = [
    { scope: 'relationship', kind: 'changed', source: 'Invoice', target: 'Customer', on: { owner_id: 'customer_id' }, fields: ['on'] },
  ];
  const r = review(items, [note('a.md', { Customer: [] })]);
  check('an entity named only through a relationship item is not an unchanged claim', r.claims.length === 0, r.claims);
}

{
  const baseline = base();
  const current = snapshot([node('Customer')], []);
  const items = diffSnapshots(baseline, current);
  const bad = parseChangeNote('bad.md', 'no frontmatter');
  const r = crossCheck(items, [note('a.md', { Invoice: [] }), bad], baseline.model);
  check(
    'review carries removed baseline nodes and edges',
    r.removedNodes.length === 1 && r.removedNodes[0]?.id === 'Invoice'
      && r.removedEdges.length === 1 && r.removedEdges[0]?.source === 'Invoice',
    r,
  );
  check(
    'review separates note errors from notes',
    r.notes.length === 1 && r.notes[0]?.file === 'a.md' && r.noteErrors.length === 1 && r.noteErrors[0]?.file === 'bad.md',
    r,
  );
}

{
  const root = mkdtempSync(join(tmpdir(), 'ignatius-change-review-wikilink-'));
  try {
    cpSync('models/key-inherited', root, { recursive: true, filter: path => !path.endsWith('/.ignatius') });
    const parsed = async (): Promise<ModelSnapshot> => ({ version: 1, model: (await parseModels(root)).model, flows: [] });
    const before = await parsed();
    unlinkSync(join(root, 'data/transactional/SalesInvoice.md'));
    const removed = diffSnapshots(before, await parsed());
    check(
      'removing a wiki-linked entity yields no doc item for an untouched body that links it',
      !removed.some(i => i.scope === 'doc' && i.entity === 'Payment'),
      removed,
    );
    const paymentPath = join(root, 'data/transactional/Payment.md');
    writeFileSync(paymentPath, readFileSync(paymentPath, 'utf8').replace('settlement event', 'receipt event'));
    const edited = diffSnapshots(before, await parsed());
    check('a real body edit still yields a doc item', edited.some(i => i.scope === 'doc' && i.entity === 'Payment'), edited);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const dependsOn: ChangeItem = { scope: 'relationship', kind: 'added', source: 'Task_Dependency', target: 'Task', on: { depends_on_task_id: 'task_id' } };
  const dependent: ChangeItem = { scope: 'relationship', kind: 'added', source: 'Task_Dependency', target: 'Task', on: { task_id: 'task_id' } };
  check(
    'the Changes panel tells the two edges of a dual-FK pair apart by their FK columns',
    itemLabel(dependsOn, null) === 'Task_Dependency → Task (depends_on_task_id) — relationship added'
      && itemLabel(dependent, null) === 'Task_Dependency → Task (task_id) — relationship added',
    [itemLabel(dependsOn, null), itemLabel(dependent, null)],
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll change-review checks passed');
