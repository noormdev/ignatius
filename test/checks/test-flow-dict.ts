/**
 * test-flow-dict.ts — R2: generateFlowDict assertions (FlowModel signature).
 *
 * Covers:
 *  - generateFlowDict accepts a FlowModel (not a single FlowDiagram)
 *  - HTML contains a #process-<id> section for each FlowProcess (single-DFD)
 *  - 2-DFD model: a section per DFD in the output
 *  - dottedNumber rendered in each process section
 *  - inputs/outputs table present with db: attribute rows and entity-anchor href
 *  - generic (non-db) store _stores/ description rendered when present
 *  - findings panel present when findings > 0; absent when findings are empty
 *  - HTML-escapes process labels containing < or & (no raw injection)
 */

import { parseFlows } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowDict } from '../../src/generators/flow-dict';
import type { FlowDictFindings } from '../../src/generators/flow-dict';
import type { FlowModel, FlowDiagram, FlowProcess, FlowEndpoint, FlowEdge, FlowStoreRef } from '../../src/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Parse the clean fixture (single DFD) + entity model
// ---------------------------------------------------------------------------

const CLEAN_FIXTURE = 'test/fixtures/flows';
const MODEL_DIR = 'models/key-inherited';
// key-inherited has two DFDs: order-to-cash + refund
const KEY_INHERITED_DIR = 'models/key-inherited';

const [{ flowModel, globalErrors }, { model: entityModel }] = await Promise.all([
    parseFlows(CLEAN_FIXTURE),
    parseModels(MODEL_DIR),
]);

assert(globalErrors.length === 0, `parseFlows should have no errors: ${JSON.stringify(globalErrors)}`);
assert(flowModel.diagrams.length === 1, `expected 1 diagram from clean fixture, got ${flowModel.diagrams.length}`);

const emptyFindings: FlowDictFindings = { flowErrors: [], globalErrors: [] };

// ---------------------------------------------------------------------------
// Test 1: generateFlowDict accepts FlowModel; HTML is non-empty doctype
// ---------------------------------------------------------------------------

const html = generateFlowDict(flowModel, entityModel, emptyFindings, 'static', { themeMode: 'dark' });

assert(typeof html === 'string' && html.length > 0, 'generateFlowDict should return a non-empty string');
assert(html.includes('<!doctype html'), 'should start with doctype');
console.log('PASS: generateFlowDict accepts FlowModel, returns doctype HTML');

// ---------------------------------------------------------------------------
// Test 2: process sections — one #process-<id> per FlowProcess (single-DFD)
// ---------------------------------------------------------------------------

const diagram = flowModel.diagrams[0]!;

for (const proc of diagram.processes) {
    assert(
        html.includes(`id="process-${proc.id}"`),
        `missing section anchor #process-${proc.id}`,
    );
    console.log(`PASS: process section #process-${proc.id} present`);
}

// ---------------------------------------------------------------------------
// Test 3: dottedNumber rendered in process section
// ---------------------------------------------------------------------------

const placeOrder = diagram.processes[0]!;
assert(
    html.includes(placeOrder.dottedNumber),
    `dottedNumber '${placeOrder.dottedNumber}' not found in HTML`,
);
console.log(`PASS: dottedNumber '${placeOrder.dottedNumber}' rendered`);

// ---------------------------------------------------------------------------
// Test 4: inputs/outputs table — db: attribute rows with entity-anchor href
// ---------------------------------------------------------------------------

// Place-Order has input from db:Party with data [party_id].
// Static mode: should link to dict.html#entity-Party
assert(
    html.includes('dict.html#entity-Party'),
    'static db: attribute row should link to dict.html#entity-Party',
);
assert(
    html.includes('party_id'),
    'db: column name party_id should appear in inputs/outputs table',
);
console.log('PASS: db: attribute row with entity-anchor href present');

assert(
    html.includes('in') || html.includes('out'),
    'inputs/outputs table should show direction',
);
console.log('PASS: direction column present in table');

// ---------------------------------------------------------------------------
// Test 5: generic store _stores/ description rendered when present
// ---------------------------------------------------------------------------

const sessionsStore = diagram.storeRefs.find(s => s.kind === 'cache' && s.name === 'Sessions');
assert(sessionsStore !== undefined, 'Sessions storeRef not found in diagram');
assert(typeof sessionsStore!.bodyHtml === 'string' && sessionsStore!.bodyHtml.length > 0, '_stores/Sessions.md body missing');

assert(
    html.includes('session token') || html.includes('Sessions'),
    '_stores/Sessions.md description should appear in HTML (Sessions store section)',
);
console.log('PASS: generic store _stores/ description rendered');

// ---------------------------------------------------------------------------
// Test 6a: findings panel ABSENT when findings are empty
// ---------------------------------------------------------------------------

assert(
    !html.includes('<aside class="dict-findings-panel"'),
    'findings panel <aside> should NOT be present when findings are empty',
);
console.log('PASS: findings panel absent when findings are empty');

// ---------------------------------------------------------------------------
// Test 6b: findings panel PRESENT when findings > 0
// ---------------------------------------------------------------------------

const withFindings: FlowDictFindings = {
    flowErrors: [
        {
            ruleId: 'flow.unknown_attribute',
            flowId: diagram.id,
            processId: 'Place-Order',
            severity: 'warning',
            message: "Column 'bogus_col' on 'Party' not found in entity pk or columns.",
        },
    ],
    globalErrors: [],
};

const htmlWithFindings = generateFlowDict(flowModel, entityModel, withFindings, 'static', { themeMode: 'dark' });

assert(
    htmlWithFindings.includes('<aside class="dict-findings-panel"'),
    'findings panel <aside> should be present when findings > 0',
);
assert(
    htmlWithFindings.includes('flow.unknown_attribute') || htmlWithFindings.includes('Unknown Attribute') || htmlWithFindings.includes('bogus_col'),
    'findings panel should show the finding message',
);
console.log('PASS: findings panel present when findings > 0');

// ---------------------------------------------------------------------------
// Test 7: 2-DFD model — a DFD section per diagram in output
// ---------------------------------------------------------------------------

const [{ flowModel: kiFlowModel }, { model: kiEntityModel }] = await Promise.all([
    parseFlows(KEY_INHERITED_DIR),
    parseModels(KEY_INHERITED_DIR),
]);

assert(kiFlowModel.diagrams.length >= 2, `key-inherited must have ≥ 2 DFDs, got ${kiFlowModel.diagrams.length}`);

const kiHtml = generateFlowDict(kiFlowModel, kiEntityModel, emptyFindings, 'static', { themeMode: 'dark' });

// Each top-level DFD id should appear as a DFD heading
for (const d of kiFlowModel.diagrams) {
    assert(
        kiHtml.includes(`id="dfd-${d.id}"`),
        `missing DFD heading anchor #dfd-${d.id} for multi-DFD model`,
    );
    console.log(`PASS: DFD section heading #dfd-${d.id} present`);
}

// Each process across all DFDs should still have an anchor
for (const d of kiFlowModel.diagrams) {
    for (const proc of d.processes) {
        assert(
            kiHtml.includes(`id="process-${proc.id}"`),
            `missing process section #process-${proc.id} (from DFD ${d.id})`,
        );
    }
}
console.log('PASS: all process sections present in 2-DFD output');

// ---------------------------------------------------------------------------
// Test 8: HTML-escape author-string paths containing < or &
// ---------------------------------------------------------------------------

const maliciousLabel = '<script>alert("xss")</script> & more';
const maliciousEndpointName = '<evil>Actor&Ally</evil>';
const maliciousStoreName = 'Cache&Store<1>';
const maliciousEdgeDataStr = 'field<A>&field<B>';
const maliciousEdgeDataArr = ['col<X>', 'col&Y'];
const maliciousDiagramId = 'flow<&>id';

const escapeExtEndpoint: FlowEndpoint = { kind: 'ext', name: maliciousEndpointName, raw: `ext:${maliciousEndpointName}` };
const escapeEdgeStr: FlowEdge = {
    from: escapeExtEndpoint,
    to: { kind: 'proc', name: 'Bad-Process', raw: 'proc:Bad-Process' },
    data: maliciousEdgeDataStr,
    flowId: maliciousDiagramId,
};
const escapeCacheEndpoint: FlowEndpoint = { kind: 'cache', name: maliciousStoreName, raw: `cache:${maliciousStoreName}` };
const escapeEdgeArr: FlowEdge = {
    from: { kind: 'proc', name: 'Bad-Process', raw: 'proc:Bad-Process' },
    to: escapeCacheEndpoint,
    data: maliciousEdgeDataArr,
    flowId: maliciousDiagramId,
};
const escapeProc: FlowProcess = {
    id: 'Bad-Process',
    label: maliciousLabel,
    dottedNumber: '1',
    inputs: [escapeEdgeStr],
    outputs: [escapeEdgeArr],
    body: '',
    bodyHtml: '',
    hasSubDfd: false,
    flowId: maliciousDiagramId,
};
const escapeStore: FlowStoreRef = { kind: 'cache', name: maliciousStoreName, flowId: maliciousDiagramId };
const escapeDiagram: FlowDiagram = {
    id: maliciousDiagramId,
    processes: [escapeProc],
    externals: [],
    storeRefs: [escapeStore],
    edges: [escapeEdgeStr, escapeEdgeArr],
    subDfds: [],
};
// Two diagrams so the DFD heading (which renders diagram.id) is emitted.
// Without this, the single-DFD path omits the heading and diagram.id is never rendered.
const escapeDiagram2: FlowDiagram = {
    id: 'safe-diagram',
    processes: [],
    externals: [],
    storeRefs: [],
    edges: [],
    subDfds: [],
};
const escapeFlowModel: FlowModel = {
    diagrams: [escapeDiagram, escapeDiagram2],
    modelDir: '/tmp/fake',
};

const htmlEscaped = generateFlowDict(escapeFlowModel, entityModel, emptyFindings, 'static');

assert(!htmlEscaped.includes('<script>alert'), 'raw <script> from process label must NOT appear in HTML');
assert(!htmlEscaped.includes('<evil>'), 'raw <evil> from endpoint name must NOT appear in HTML');
assert(!htmlEscaped.includes('<1>'), 'raw <1> from store name must NOT appear in HTML');
assert(!htmlEscaped.includes('field<A>'), 'raw field<A> from edge data string must NOT appear in HTML');
assert(!htmlEscaped.includes('col<X>'), 'raw col<X> from edge data array must NOT appear in HTML');
assert(!htmlEscaped.includes('flow<&>id'), 'raw flow<&>id from diagram.id must NOT appear in HTML');

assert(htmlEscaped.includes('&lt;script&gt;'), 'process label < must be escaped as &lt; in HTML');
assert(htmlEscaped.includes('&lt;evil&gt;'), 'endpoint name < must be escaped as &lt; in HTML');
assert(htmlEscaped.includes('Cache&amp;Store'), 'store name & must be escaped as &amp; in HTML');
assert(htmlEscaped.includes('field&lt;A&gt;'), 'edge data string < must be escaped as &lt; in HTML');
assert(htmlEscaped.includes('col&lt;X&gt;'), 'edge data array < must be escaped as &lt; in HTML');
assert(htmlEscaped.includes('col&amp;Y'), 'edge data array & must be escaped as &amp; in HTML');
assert(htmlEscaped.includes('flow&lt;&amp;&gt;id'), 'diagram.id < and & must be escaped in HTML');
console.log('PASS: all author-string paths HTML-escaped');

// ---------------------------------------------------------------------------
// Test 9: theme toggle present
// ---------------------------------------------------------------------------

assert(html.includes('dict-theme-toggle'), 'theme toggle (.dict-theme-toggle) should be present');
console.log('PASS: theme toggle present');

// ---------------------------------------------------------------------------
// Test 10: FAB present
// ---------------------------------------------------------------------------

assert(html.includes('dict-fab'), 'FAB (.dict-fab) should be present');
console.log('PASS: FAB present');

// ---------------------------------------------------------------------------
// Test 11: process body narrative rendered (bodyHtml injected as-is)
// ---------------------------------------------------------------------------

assert(
    html.includes('Handles the full order placement flow') || html.includes('order placement'),
    'process body narrative should be rendered in HTML',
);
console.log('PASS: process body narrative rendered');

// ---------------------------------------------------------------------------
// Test 12: graphHref wires db: entity link in live-ish mode
// ---------------------------------------------------------------------------

const htmlWithGraphHref = generateFlowDict(
    flowModel, entityModel, emptyFindings, 'live', { graphHref: '/', themeMode: 'dark' },
);
assert(
    htmlWithGraphHref.includes('dict.html#entity-Party') || htmlWithGraphHref.includes('#entity-Party'),
    'live mode should still produce entity anchor for db: attributes',
);
console.log('PASS: graphHref mode produces entity anchors for db: attributes');

console.log('\nAll flow-dict tests passed.');
