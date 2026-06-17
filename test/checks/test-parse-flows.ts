/**
 * test-parse-flows.ts — CP-1 parse-flows assertions.
 *
 * Covers:
 *  - parseFlows returns FlowModel with correct diagram shape (processes, externals, storeRefs, edges)
 *  - Recursive sub-DFD detection: hasSubDfd, subDfds populated to leaves
 *  - Optional stores/<name>.md body attached to its FlowStoreRef (read from model-root stores/)
 *  - dottedNumber composed from local number: along the folder path
 *  - Entity-file exclusion: no flow process file appears as a ModelNode in parseModels
 */

import { parseFlows } from '../../src/flows/flow-parse';
import { parseModels } from '../../src/model/parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

/** Walk the leveled tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
    for (const d of diagrams) {
        if (d.id === id) return d;
        const found = findDiagramInTree(d.subDfds, id);
        if (found) return found;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// parseFlows — clean fixture
// ---------------------------------------------------------------------------

const CLEAN_FIXTURE = 'test/fixtures/flows';

const { flowModel, globalErrors } = await parseFlows(CLEAN_FIXTURE);

assert(globalErrors.length === 0, `parseFlows clean fixture — expected no globalErrors, got: ${JSON.stringify(globalErrors)}`);
// After CP4 leveling the top-level diagrams array contains the synthesised
// context (Level-0) diagram. The leaf 'clean' diagram is nested inside the tree.
assert(flowModel.diagrams.length > 0, `parseFlows — expected at least 1 diagram (context), got 0`);
console.log('PASS: parseFlows clean fixture — no errors, diagrams present');

const diagram = findDiagramInTree(flowModel.diagrams, 'clean');
assert(diagram !== undefined, `diagram 'clean' not found in leveled tree; top-level ids: ${flowModel.diagrams.map(d => d.id).join(', ')}`);
console.log('PASS: diagram.id = clean');

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

assert(diagram.processes.length === 1, `expected 1 top-level process, got ${diagram.processes.length}`);
const placeOrder = diagram.processes[0]!;
assert(placeOrder.id === 'Place-Order', `process id should be 'Place-Order', got '${placeOrder.id}'`);
assert(placeOrder.label === 'Place Order', `process label should be 'Place Order', got '${placeOrder.label}'`);
assert(placeOrder.number === 1, `process number should be 1, got ${placeOrder.number}`);
// After CP4 leveling the leaf 'clean' is the 1st (and only) L1 activity (N=1),
// so its processes are renumbered to '1.<local>'. Place-Order was local '1' → now '1.1'.
assert(placeOrder.dottedNumber === '1.1', `dottedNumber should be '1.1' (CP4 renumbering), got '${placeOrder.dottedNumber}'`);
assert(placeOrder.flowId === 'clean', `process flowId should be 'clean', got '${placeOrder.flowId}'`);
assert(typeof placeOrder.bodyHtml === 'string' && placeOrder.bodyHtml.length > 0, 'process bodyHtml should be non-empty');
console.log('PASS: top-level process shape correct');

// ---------------------------------------------------------------------------
// Recursive decomposition: hasSubDfd + subDfds
// ---------------------------------------------------------------------------

assert(placeOrder.hasSubDfd === true, 'Place-Order should have hasSubDfd=true (Place-Order/ folder exists)');
assert(diagram.subDfds.length === 1, `expected 1 subDfd on diagram, got ${diagram.subDfds.length}`);
console.log('PASS: hasSubDfd=true, subDfds.length=1');

const subDfd = diagram.subDfds[0]!;
assert(subDfd.id === 'Place-Order', `subDfd.id should be 'Place-Order', got '${subDfd.id}'`);
assert(subDfd.processes.length === 1, `subDfd should have 1 process, got ${subDfd.processes.length}`);
const reserveStock = subDfd.processes[0]!;
assert(reserveStock.id === 'Reserve-Stock', `sub-process id should be 'Reserve-Stock', got '${reserveStock.id}'`);
assert(reserveStock.label === 'Reserve Stock', `sub-process label should be 'Reserve Stock', got '${reserveStock.label}'`);
assert(reserveStock.number === 1, `sub-process number should be 1, got ${reserveStock.number}`);
// Reserve-Stock is in the sub-DFD of Place-Order. After the renumberLeaf fix,
// the entire subDfd subtree is renumbered recursively. The parser gives
// Reserve-Stock a relative dottedNumber of '1.1' (parentDottedNumbers=[1] for
// Place-Order, plus local number 1 → [1,1]). With prefix '1.' from the L1
// parent, that becomes '1.1.1'.
assert(reserveStock.dottedNumber === '1.1.1', `sub-process dottedNumber should be '1.1.1' (recursive renumbering), got '${reserveStock.dottedNumber}'`);
assert(reserveStock.hasSubDfd === false, 'Reserve-Stock should have hasSubDfd=false');
assert(subDfd.subDfds.length === 0, `sub-DFD should have no further subDfds, got ${subDfd.subDfds.length}`);
console.log('PASS: recursive sub-DFD: Reserve-Stock in Place-Order/, dottedNumber=1.1.1');

// ---------------------------------------------------------------------------
// Externals
// ---------------------------------------------------------------------------

// The clean fixture has TWO externals in the registry (Shopper + UnusedActor), but
// only Shopper is referenced by any edge. diagram.externals must be the
// REFERENCED-AND-DEFINED set — UnusedActor must NOT appear here even though it
// has an externals/UnusedActor.md definition.
assert(diagram.externals.length === 1, `expected exactly 1 external (referenced-and-defined), got ${diagram.externals.length}: ${diagram.externals.map(e => e.id).join(', ')}`);
const unusedPresent = diagram.externals.some(e => e.id === 'UnusedActor');
assert(!unusedPresent, `diagram.externals must NOT include UnusedActor (defined-but-unreferenced)`);
console.log('PASS: diagram.externals = referenced-and-defined only (UnusedActor absent)');

const shopper = diagram.externals[0]!;
assert(shopper.id === 'Shopper', `external id should be 'Shopper', got '${shopper.id}'`);
assert(shopper.label === 'Shopper', `external label should be 'Shopper', got '${shopper.label}'`);
assert(shopper.flowId === 'clean', `external flowId should be 'clean', got '${shopper.flowId}'`);
assert(typeof shopper.bodyHtml === 'string' && shopper.bodyHtml.length > 0, 'external bodyHtml should be non-empty');
console.log('PASS: external Shopper present with bodyHtml');

// ---------------------------------------------------------------------------
// Edges from top-level diagram (from Place-Order's inputs/outputs)
// ---------------------------------------------------------------------------

assert(diagram.edges.length > 0, `expected edges in diagram, got 0`);

// ext:Shopper → Place-Order
const shopperToPlaceOrder = diagram.edges.find(e =>
    e.from.kind === 'ext' && e.from.name === 'Shopper' &&
    e.to.kind === 'proc' && e.to.name === 'Place-Order',
);
assert(shopperToPlaceOrder !== undefined, 'edge ext:Shopper → proc:Place-Order not found');
assert(shopperToPlaceOrder.data === 'order request', `edge data should be 'order request', got '${shopperToPlaceOrder.data}'`);
console.log('PASS: edge ext:Shopper → proc:Place-Order');

// db:Party → Place-Order
const partyToPlaceOrder = diagram.edges.find(e =>
    e.from.kind === 'db' && e.from.name === 'Party' &&
    e.to.kind === 'proc' && e.to.name === 'Place-Order',
);
assert(partyToPlaceOrder !== undefined, 'edge db:Party → proc:Place-Order not found');
assert(Array.isArray(partyToPlaceOrder.data) && (partyToPlaceOrder.data as string[]).includes('party_id'), 'db:Party input should carry party_id column');
console.log('PASS: edge db:Party → proc:Place-Order with column data');

// Place-Order → cache:Sessions
const placeOrderToSessions = diagram.edges.find(e =>
    e.from.kind === 'proc' && e.from.name === 'Place-Order' &&
    e.to.kind === 'cache' && e.to.name === 'Sessions',
);
assert(placeOrderToSessions !== undefined, 'edge proc:Place-Order → cache:Sessions not found');
console.log('PASS: edge proc:Place-Order → cache:Sessions');

// ---------------------------------------------------------------------------
// Store refs — deduplicated
// ---------------------------------------------------------------------------

// Party (db:) and Sessions (cache:) should both appear
const partyStore = diagram.storeRefs.find(s => s.kind === 'db' && s.name === 'Party');
assert(partyStore !== undefined, 'storeRef db:Party not found');

const sessionsStore = diagram.storeRefs.find(s => s.kind === 'cache' && s.name === 'Sessions');
assert(sessionsStore !== undefined, 'storeRef cache:Sessions not found');
console.log('PASS: storeRefs contain db:Party and cache:Sessions');

// ---------------------------------------------------------------------------
// stores/Sessions.md body attached to cache:Sessions FlowStoreRef
// ---------------------------------------------------------------------------

assert(sessionsStore !== undefined, 'Sessions storeRef missing');
assert(typeof sessionsStore!.body === 'string' && sessionsStore!.body.length > 0, 'stores/Sessions.md body not attached to storeRef');
assert(typeof sessionsStore!.bodyHtml === 'string' && sessionsStore!.bodyHtml.length > 0, 'stores/Sessions.md bodyHtml not rendered');
assert(sessionsStore!.body.includes('session tokens'), `Sessions body should mention session tokens, got: ${sessionsStore!.body}`);
console.log('PASS: stores/Sessions.md body attached to cache:Sessions storeRef');

// db: storeRef (Party) has no body (no stores/Party.md — db: stores are entities described in their own .md)
assert(partyStore!.body === undefined, `db:Party storeRef should have no body (got: ${partyStore!.body})`);
console.log('PASS: db:Party storeRef has no body (inline entity, not a stores/ file)');

// ---------------------------------------------------------------------------
// modelDir
// ---------------------------------------------------------------------------

assert(flowModel.modelDir === CLEAN_FIXTURE, `flowModel.modelDir should be '${CLEAN_FIXTURE}', got '${flowModel.modelDir}'`);
console.log('PASS: flowModel.modelDir set correctly');

// ---------------------------------------------------------------------------
// Entity-file exclusion: parseModels on a model with a flows/ directory
// must not include any flow process/external file as a ModelNode
// ---------------------------------------------------------------------------

const FLOWS_MODEL_FIXTURE = 'test/fixtures/flows-model';

const { model: entityModel, globalErrors: entityGlobalErrors } = await parseModels(FLOWS_MODEL_FIXTURE);

// Process-Payment.md in flows/checkout/ must NOT appear as a ModelNode
const flowNodeIds = entityModel.nodes.map(n => n.id);
assert(!flowNodeIds.includes('Process-Payment'), `parseModels should NOT include flow process 'Process-Payment' as a ModelNode (found in nodes: ${flowNodeIds.join(', ')})`);
assert(!flowNodeIds.includes('Buyer'), `parseModels should NOT include flow external 'Buyer' as a ModelNode`);

// The one real entity (Customer) should still be there
assert(flowNodeIds.includes('Customer'), `parseModels should include 'Customer' as a ModelNode (found: ${flowNodeIds.join(', ')})`);

// The parse errors about Process-Payment.md (missing entity field) should NOT appear
// because the file is excluded before parsing — not just silently skipped
const flowFileErrors = entityGlobalErrors.filter(e =>
    e.omitted.id.includes('flows/') || e.omitted.id.includes('Process-Payment') || e.omitted.id.includes('Buyer'),
);
assert(flowFileErrors.length === 0, `parseModels should not emit errors for flows/ files (got: ${JSON.stringify(flowFileErrors)})`);

console.log('PASS: entity-file exclusion — flows/ files excluded from parseModels (no node, no error)');
console.log(`PASS: parseModels nodes: ${flowNodeIds.join(', ')}`);

console.log('\nAll flow parse tests passed.');
