/**
 * test-flow-nav.ts — navigation data behind the flow index and the
 * breadcrumb level menus (src/flow-view/flow-nav.ts).
 *
 * Why it matters: a large model has dozens of flows reachable only through
 * the leveled tree. The index must list every diagram and process with a
 * description, a level menu must offer exactly the diagrams beside the current
 * one, and every row must land on the right diagram even when two flows share
 * a process file name.
 */

import { assert } from '../assert';
import { deriveLevels, CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID } from '../../src/flows/flow-derive-levels';
import type { FlowDiagram, FlowProcess } from '../../src/flows/flow-parse';
import { buildFlowIndex, defaultDiagramPath, diagramRef, findDiagramByRef, levelEntries, resolveDiagramPath } from '../../src/flow-view/flow-nav';
import type { FlowIndexNode } from '../../src/flow-view/flow-nav';

function proc(id: string, dottedNumber: string, extra: Partial<FlowProcess> = {}): FlowProcess {
  return { id, label: id, dottedNumber, inputs: [], outputs: [], body: '', bodyHtml: '', hasSubDfd: false, flowId: '', ...extra };
}

function diagram(id: string, processes: FlowProcess[], subDfds: FlowDiagram[] = [], description?: string): FlowDiagram {
  return { id, title: id, processes, externals: [], storeRefs: [], edges: [], subDfds, ...(description ? { description } : {}) };
}

// Two flows each decompose a process named "Submit": the ids collide below
// the flow level, which is exactly what a bare-id lookup gets wrong.
const billingSubmit = diagram('Submit', [proc('Check', '1.1')]);
const billing = diagram('billing', [
  proc('Submit', '1', { hasSubDfd: true, description: 'Submit an invoice.' }),
  proc('Cancel', '2'),
], [billingSubmit], 'Billing scopes.');
const ordersSubmit = diagram('Submit', [proc('Price', '1.1'), proc('Place', '1.2')]);
const orders = diagram('orders', [proc('Submit', '1', { hasSubDfd: true })], [ordersSubmit]);

const leveled = deriveLevels({ diagrams: [billing, orders], modelDir: '', externals: [], clusters: [] }).diagrams;
const MODEL_DESC = 'The whole model.';

// Paths resolve exactly, including the colliding sub-DFD ids.
{
  const ordersPath = resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID, 'orders', 'Submit']);
  assert(ordersPath !== null && ordersPath.at(-1)!.processes.length === 2, 'FAIL: orders/Submit must resolve to the orders sub-DFD (2 processes), not billing\'s');
  assert(resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID, 'nope']) === null, 'FAIL: a broken path must resolve to null');
  assert(resolveDiagramPath(leveled, []) === null, 'FAIL: an empty path must resolve to null');
  console.log('PASS: id paths resolve exactly, even when sub-DFD ids collide');
}

// A deep-link reference survives a reload: it names the exact sub-DFD, drops
// the derived levels, and an old bare-id link still resolves as before.
{
  const ordersPath = resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID, 'orders', 'Submit'])!;
  assert(diagramRef(ordersPath) === 'orders/Submit', `FAIL: sub-DFD ref is the authored path, got ${diagramRef(ordersPath)}`);
  assert(diagramRef(ordersPath.slice(0, 2)) === SYSTEM_PROCESS_ID, 'FAIL: a derived diagram is referenced by its own id');
  assert(diagramRef(ordersPath.slice(0, 3)) === 'orders', 'FAIL: a top-level flow ref is its bare id, as links always were');

  const byRef = findDiagramByRef(leveled, 'orders/Submit');
  assert(byRef !== null && byRef.at(-1)!.processes.some(p => p.id === 'Place'), 'FAIL: orders/Submit resolves to the orders sub-DFD');
  const byBareId = findDiagramByRef(leveled, 'Submit');
  assert(byBareId !== null && byBareId.at(-2)!.id === 'billing', 'FAIL: a bare id resolves to the first match in tree order, as before');
  assert(findDiagramByRef(leveled, SYSTEM_PROCESS_ID)?.length === 2, 'FAIL: a derived diagram ref resolves');
  assert(findDiagramByRef(leveled, 'nope/Submit') === null, 'FAIL: an unknown ref resolves to null');
  console.log('PASS: diagram refs round-trip exactly and bare-id links keep working');
}

// The Flows view opens on the overview of every flow, not the one-box Context.
{
  const landing = defaultDiagramPath(leveled).map(d => d.id);
  assert(JSON.stringify(landing) === JSON.stringify([CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID]), `FAIL: default path should end at the System overview, got ${JSON.stringify(landing)}`);
  assert(JSON.stringify(defaultDiagramPath([billing, orders]).map(d => d.id)) === '["billing"]', 'FAIL: an unleveled tree opens on its first root');
  assert(defaultDiagramPath([]).length === 0, 'FAIL: no diagrams, no default path');
  console.log('PASS: the default diagram is the System overview');
}

// Level menus list the diagrams beside the current one, with descriptions.
{
  const roots = levelEntries(null, leveled, MODEL_DESC);
  assert(roots.length === 1 && roots[0]!.diagramId === CONTEXT_DIAGRAM_ID, 'FAIL: the root level is the Context diagram');
  assert(roots[0]!.description === MODEL_DESC, 'FAIL: the Context entry falls back to the model description');

  const system = resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID])!.at(-1)!;
  const flows = levelEntries(system, leveled, MODEL_DESC);
  assert(JSON.stringify(flows.map(f => f.diagramId)) === '["billing","orders"]', `FAIL: system level lists the flows in order, got ${JSON.stringify(flows.map(f => f.diagramId))}`);
  assert(flows[0]!.description === 'Billing scopes.' && flows[0]!.number === '1', 'FAIL: a flow entry carries its index.md description and number');
  assert(flows[1]!.description === undefined, 'FAIL: an undescribed flow has no description (no invented text)');
  assert(flows[0]!.processCount === 2, 'FAIL: a flow entry counts its processes');

  const billingLevel = levelEntries(resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID, SYSTEM_PROCESS_ID, 'billing'])!.at(-1)!, leveled, MODEL_DESC);
  assert(billingLevel.length === 1 && billingLevel[0]!.diagramId === 'Submit', 'FAIL: only processes with a sub-DFD appear in a level menu');
  assert(billingLevel[0]!.description === 'Submit an invoice.', 'FAIL: a sub-DFD entry is described by its process');

  const contextLevel = levelEntries(resolveDiagramPath(leveled, [CONTEXT_DIAGRAM_ID])!.at(-1)!, leveled, MODEL_DESC);
  assert(contextLevel.length === 1 && contextLevel[0]!.description === MODEL_DESC, 'FAIL: the whole-system process is described by the model description');
  console.log('PASS: level entries list same-level diagrams with number, description, and process count');
}

// The index covers every process; each row opens its own diagram or its container.
{
  const index = buildFlowIndex(leveled, MODEL_DESC);
  const all: FlowIndexNode[] = [];
  const walk = (nodes: FlowIndexNode[]) => { for (const n of nodes) { all.push(n); walk(n.children); } };
  walk(index);

  const keys = new Set(all.map(n => n.key));
  assert(keys.size === all.length, 'FAIL: index keys must be unique even when process ids repeat');

  assert(JSON.stringify(index.map(n => n.label)) === '["billing","orders"]', `FAIL: the flows are the top level, with no Context or System rows above them, got ${JSON.stringify(index.map(n => n.label))}`);
  assert(!all.some(n => n.path.at(-1) === CONTEXT_DIAGRAM_ID || (n.opensOwnDiagram && n.path.at(-1) === SYSTEM_PROCESS_ID)), 'FAIL: no row opens a derived level');
  // 2 flows + billing(Submit, Cancel) + Check + orders(Submit) + Price + Place
  assert(all.length === 8, `FAIL: expected 8 rows, got ${all.length}`);

  const cancel = all.find(n => n.label === 'Cancel')!;
  assert(!cancel.opensOwnDiagram && cancel.path.join('/') === `${CONTEXT_DIAGRAM_ID}/${SYSTEM_PROCESS_ID}/billing`, 'FAIL: a process without a sub-DFD opens the diagram that contains it');

  const place = all.find(n => n.label === 'Place')!;
  assert(place.path.join('/') === `${CONTEXT_DIAGRAM_ID}/${SYSTEM_PROCESS_ID}/orders/Submit`, 'FAIL: a nested leaf opens its exact containing sub-DFD');

  const flowRow = all.find(n => n.label === 'billing' && n.number === '1')!;
  assert(flowRow.opensOwnDiagram && flowRow.description === 'Billing scopes.', 'FAIL: a flow row opens the flow and shows its description');
  console.log('PASS: the index lists every process with a unique key and the exact diagram path it opens');
}

console.log('\nAll flow-nav tests passed.');
