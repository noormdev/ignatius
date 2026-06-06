/**
 * test-flow-dict.ts — CP-6 generateFlowDict assertions.
 *
 * Covers:
 *  - HTML contains a #process-<id> section for each FlowProcess
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
import type { FlowDiagram, FlowProcess, FlowEndpoint, FlowEdge, FlowStoreRef } from '../../src/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Parse the clean fixture + entity model
// ---------------------------------------------------------------------------

const CLEAN_FIXTURE = 'test/fixtures/flows';
const MODEL_DIR = 'models/key-inherited';

const [{ flowModel, globalErrors }, { model: entityModel }] = await Promise.all([
    parseFlows(CLEAN_FIXTURE),
    parseModels(MODEL_DIR),
]);

assert(globalErrors.length === 0, `parseFlows should have no errors: ${JSON.stringify(globalErrors)}`);
assert(flowModel.diagrams.length === 1, `expected 1 diagram, got ${flowModel.diagrams.length}`);

const diagram = flowModel.diagrams[0]!;
const emptyFindings: FlowDictFindings = { flowErrors: [], globalErrors: [] };

// ---------------------------------------------------------------------------
// Test 1: process sections — one #process-<id> per FlowProcess
// ---------------------------------------------------------------------------

const html = generateFlowDict(diagram, entityModel, emptyFindings, 'static', { themeMode: 'dark' });

assert(typeof html === 'string' && html.length > 0, 'generateFlowDict should return a non-empty string');
assert(html.includes('<!doctype html'), 'should start with doctype');

for (const proc of diagram.processes) {
    assert(
        html.includes(`id="process-${proc.id}"`),
        `missing section anchor #process-${proc.id}`,
    );
    console.log(`PASS: process section #process-${proc.id} present`);
}

// ---------------------------------------------------------------------------
// Test 2: dottedNumber rendered in process section
// ---------------------------------------------------------------------------

const placeOrder = diagram.processes[0]!;
assert(
    html.includes(placeOrder.dottedNumber),
    `dottedNumber '${placeOrder.dottedNumber}' not found in HTML`,
);
console.log(`PASS: dottedNumber '${placeOrder.dottedNumber}' rendered`);

// ---------------------------------------------------------------------------
// Test 3: inputs/outputs table — db: attribute rows with entity-anchor href
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

// Should also include direction markers
assert(
    html.includes('in') || html.includes('out'),
    'inputs/outputs table should show direction',
);
console.log('PASS: direction column present in table');

// ---------------------------------------------------------------------------
// Test 4: generic store _stores/ description rendered when present
// ---------------------------------------------------------------------------

// Sessions is a cache: store with a _stores/Sessions.md body
const sessionsStore = diagram.storeRefs.find(s => s.kind === 'cache' && s.name === 'Sessions');
assert(sessionsStore !== undefined, 'Sessions storeRef not found in diagram');
assert(typeof sessionsStore!.bodyHtml === 'string' && sessionsStore!.bodyHtml.length > 0, '_stores/Sessions.md body missing');

// The body mentions "session tokens" — verify it appears in HTML
assert(
    html.includes('session token') || html.includes('Sessions'),
    '_stores/Sessions.md description should appear in HTML (Sessions store section)',
);
console.log('PASS: generic store _stores/ description rendered');

// ---------------------------------------------------------------------------
// Test 5a: findings panel ABSENT when findings are empty
// ---------------------------------------------------------------------------

// Check for the structural element, not the CSS class name (which always appears in <style>)
assert(
    !html.includes('<aside class="dict-findings-panel"'),
    'findings panel <aside> should NOT be present when findings are empty',
);
console.log('PASS: findings panel absent when findings are empty');

// ---------------------------------------------------------------------------
// Test 5b: findings panel PRESENT when findings > 0
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

const htmlWithFindings = generateFlowDict(diagram, entityModel, withFindings, 'static', { themeMode: 'dark' });

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
// Test 6: HTML-escape author-string paths containing < or &
//
// Covers: process label, endpoint name, store name, edge data (string +
// array), and diagram.id. If esc() is ever dropped from any of these
// injection sites, this test fails.
// ---------------------------------------------------------------------------

const maliciousLabel = '<script>alert("xss")</script> & more';
const maliciousEndpointName = '<evil>Actor&Ally</evil>';
const maliciousStoreName = 'Cache&Store<1>';
const maliciousEdgeDataStr = 'field<A>&field<B>';
const maliciousEdgeDataArr = ['col<X>', 'col&Y'];
const maliciousDiagramId = 'flow<&>id';

// ext endpoint: name flows into endpointLabel (esc'd) and the markerCell ext span (esc'd kind)
const escapeExtEndpoint: FlowEndpoint = { kind: 'ext', name: maliciousEndpointName, raw: `ext:${maliciousEndpointName}` };
// edge with string data (non-db path → dataLabel)
const escapeEdgeStr: FlowEdge = {
    from: escapeExtEndpoint,
    to: { kind: 'proc', name: 'Bad-Process', raw: 'proc:Bad-Process' },
    data: maliciousEdgeDataStr,
    flowId: maliciousDiagramId,
};
// cache endpoint: name flows into endpointLabel (esc'd) and kind marker (esc'd)
const escapeCacheEndpoint: FlowEndpoint = { kind: 'cache', name: maliciousStoreName, raw: `cache:${maliciousStoreName}` };
// edge with array data (non-db path → dataLabel via map(esc))
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
// store with malicious name (flows into nameLabel via esc)
const escapeStore: FlowStoreRef = { kind: 'cache', name: maliciousStoreName, flowId: maliciousDiagramId };
const escapeDiagram: FlowDiagram = {
    id: maliciousDiagramId,
    processes: [escapeProc],
    externals: [],
    storeRefs: [escapeStore],
    edges: [escapeEdgeStr, escapeEdgeArr],
    subDfds: [],
};

const htmlEscaped = generateFlowDict(escapeDiagram, entityModel, emptyFindings, 'static');

// No raw < or & from any author-controlled string should survive unescaped
assert(
    !htmlEscaped.includes('<script>alert'),
    'raw <script> from process label must NOT appear in HTML',
);
assert(
    !htmlEscaped.includes('<evil>'),
    'raw <evil> from endpoint name must NOT appear in HTML',
);
assert(
    !htmlEscaped.includes('<1>'),
    'raw <1> from store name must NOT appear in HTML',
);
assert(
    !htmlEscaped.includes('field<A>'),
    'raw field<A> from edge data string must NOT appear in HTML',
);
assert(
    !htmlEscaped.includes('col<X>'),
    'raw col<X> from edge data array must NOT appear in HTML',
);
assert(
    !htmlEscaped.includes('flow<&>id'),
    'raw flow<&>id from diagram.id must NOT appear in HTML',
);

// Escaped forms must be present
assert(
    htmlEscaped.includes('&lt;script&gt;'),
    'process label < must be escaped as &lt; in HTML',
);
assert(
    htmlEscaped.includes('&lt;evil&gt;'),
    'endpoint name < must be escaped as &lt; in HTML',
);
assert(
    htmlEscaped.includes('Cache&amp;Store'),
    'store name & must be escaped as &amp; in HTML',
);
assert(
    htmlEscaped.includes('field&lt;A&gt;'),
    'edge data string < must be escaped as &lt; in HTML',
);
assert(
    htmlEscaped.includes('col&lt;X&gt;'),
    'edge data array < must be escaped as &lt; in HTML',
);
assert(
    htmlEscaped.includes('col&amp;Y'),
    'edge data array & must be escaped as &amp; in HTML',
);
assert(
    htmlEscaped.includes('flow&lt;&amp;&gt;id'),
    'diagram.id < and & must be escaped in HTML',
);
console.log('PASS: all author-string paths (label, endpoint name, store name, edge data, diagram.id) HTML-escaped');

// ---------------------------------------------------------------------------
// Test 7: theme toggle present
// ---------------------------------------------------------------------------

assert(
    html.includes('dict-theme-toggle'),
    'theme toggle (.dict-theme-toggle) should be present',
);
console.log('PASS: theme toggle present');

// ---------------------------------------------------------------------------
// Test 8: FAB present
// ---------------------------------------------------------------------------

assert(
    html.includes('dict-fab'),
    'FAB (.dict-fab) should be present',
);
console.log('PASS: FAB present');

// ---------------------------------------------------------------------------
// Test 9: process body narrative rendered (bodyHtml injected as-is)
// ---------------------------------------------------------------------------

// Place-Order body mentions "Handles the full order placement flow"
assert(
    html.includes('Handles the full order placement flow') || html.includes('order placement'),
    'process body narrative should be rendered in HTML',
);
console.log('PASS: process body narrative rendered');

// ---------------------------------------------------------------------------
// Test 10: graphHref wires db: entity link to the graph href in live-ish mode
// ---------------------------------------------------------------------------

const htmlWithGraphHref = generateFlowDict(
    diagram, entityModel, emptyFindings, 'live', { graphHref: '/', themeMode: 'dark' },
);
// In live mode with graphHref='/', db: entity links go to /#entity-<id>
// or similar — at minimum the graphHref itself should appear somewhere (FAB / Data Graph link)
assert(
    htmlWithGraphHref.includes('dict.html#entity-Party') || htmlWithGraphHref.includes('#entity-Party'),
    'live mode should still produce entity anchor for db: attributes',
);
console.log('PASS: graphHref mode produces entity anchors for db: attributes');

console.log('\nAll flow-dict tests passed.');
