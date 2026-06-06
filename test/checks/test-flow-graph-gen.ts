/**
 * test-flow-graph-gen.ts — R1 (updated): generateFlowGraph static HTML injection.
 *
 * Verifies the emitted HTML string carries:
 *   - window.__FLOW_MODEL__ as a JSON ARRAY of FlowDiagrams
 *   - window.__FLOW_LAYOUT_KEYS__ as a JSON OBJECT (id→fingerprint map)
 *   - the live-mode script is stripped
 *   - </script> escape round-trip is preserved
 *
 * Runs against:
 *  - clean flow fixture: test/fixtures/flows (produces diagram.id = 'clean',
 *    process 'Place-Order' with label 'Place Order')
 *  - entity model: models/key-inherited
 */

import { parseFlows } from '../../src/flow-parse';
import type { FlowDiagram } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowGraph, buildFlowLayoutKeys } from '../../src/generators/flow-graph';
import type { FlowModel } from '../../src/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Helper: extract window.__FLOW_MODEL__ value from emitted HTML, parse as JSON,
// and return the array of FlowDiagrams. Throws if not found or not valid.
// ---------------------------------------------------------------------------
function extractFlowModelArray(html: string): FlowDiagram[] {
    // Match the assignment up to its terminating semicolon, before the next
    // assignment (window.__FLOW_LAYOUT_KEYS__) in the same <script> block.
    const match = html.match(/window\.__FLOW_MODEL__ = (.*?); window\.__FLOW_LAYOUT_KEYS__/s);
    assert(match !== null, '__FLOW_MODEL__ assignment not found in emitted HTML');
    const raw = match[1]!;
    // Undo the <\/script> → </script> escape so JSON.parse sees the original value.
    const unescaped = raw.replace(/<\\\/script/gi, '</script');
    return JSON.parse(unescaped) as FlowDiagram[];
}

// ---------------------------------------------------------------------------
// Helper: extract window.__FLOW_LAYOUT_KEYS__ value from emitted HTML.
// ---------------------------------------------------------------------------
function extractFlowLayoutKeys(html: string): Record<string, string> {
    const match = html.match(/window\.__FLOW_LAYOUT_KEYS__ = (.*?); window\.__THEME_MODE__/s);
    assert(match !== null, '__FLOW_LAYOUT_KEYS__ assignment not found in emitted HTML');
    const raw = match[1]!;
    const unescaped = raw.replace(/<\\\/script/gi, '</script');
    return JSON.parse(unescaped) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Setup — clean fixture
// ---------------------------------------------------------------------------

const CLEAN_FIXTURE = 'test/fixtures/flows';
const MODEL_DIR = 'models/key-inherited';

const [{ flowModel, globalErrors: flowGlobalErrors }, { model }] = await Promise.all([
    parseFlows(CLEAN_FIXTURE),
    parseModels(MODEL_DIR),
]);

assert(flowGlobalErrors.length === 0, `parseFlows clean fixture produced errors: ${JSON.stringify(flowGlobalErrors)}`);
assert(flowModel.diagrams.length === 1, `expected 1 diagram, got ${flowModel.diagrams.length}`);

const diagram = flowModel.diagrams[0]!;
assert(diagram.id === 'clean', `diagram.id should be 'clean', got '${diagram.id}'`);

const flowLayoutKeys = buildFlowLayoutKeys(flowModel);

const html = await generateFlowGraph(flowModel, model, 'static', {
    flowLayoutKeys,
    themeMode: 'dark',
});

// ---------------------------------------------------------------------------
// Assertions — structural injections
// ---------------------------------------------------------------------------

// 1. __IGNATIUS_SURFACE__ = "flow"
assert(
    html.includes('window.__IGNATIUS_SURFACE__ = "flow"'),
    '__IGNATIUS_SURFACE__ must be set to "flow"',
);
console.log('PASS: window.__IGNATIUS_SURFACE__ = "flow" present');

// 2. __IGNATIUS_MODE__ = "static"
assert(
    html.includes('window.__IGNATIUS_MODE__ = "static"'),
    '__IGNATIUS_MODE__ must be set to "static"',
);
console.log('PASS: window.__IGNATIUS_MODE__ = "static" present');

// 3. __FLOW_MODEL__ — must be a JSON ARRAY
const parsedArray = extractFlowModelArray(html);
assert(Array.isArray(parsedArray), '__FLOW_MODEL__ must parse to an array');
assert(
    parsedArray.length === flowModel.diagrams.length,
    `__FLOW_MODEL__ array length must match model's diagram count (${flowModel.diagrams.length}), got ${parsedArray.length}`,
);
console.log(`PASS: window.__FLOW_MODEL__ is an array of length ${parsedArray.length}`);

// 4. First diagram in the array has the expected id and process
const parsedDiagram = parsedArray[0]!;
assert(
    parsedDiagram.id === 'clean',
    `parsed __FLOW_MODEL__[0].id must be 'clean', got '${parsedDiagram.id}'`,
);
const placeOrderProc = parsedDiagram.processes.find(p => p.id === 'Place-Order');
assert(
    placeOrderProc !== undefined,
    '__FLOW_MODEL__[0] must contain process id "Place-Order"',
);
assert(
    placeOrderProc.label === 'Place Order',
    `process label must be 'Place Order', got '${placeOrderProc.label}'`,
);
console.log('PASS: window.__FLOW_MODEL__[0] well-formed with process id=Place-Order label="Place Order"');

// 5. __FLOW_LAYOUT_KEYS__ — must be a JSON OBJECT (not a scalar) with entry per diagram id
const parsedKeys = extractFlowLayoutKeys(html);
assert(
    typeof parsedKeys === 'object' && parsedKeys !== null && !Array.isArray(parsedKeys),
    '__FLOW_LAYOUT_KEYS__ must parse to a non-null, non-array object',
);
// Every top-level diagram id must be present in the map.
for (const d of flowModel.diagrams) {
    assert(
        d.id in parsedKeys,
        `__FLOW_LAYOUT_KEYS__ must contain an entry for diagram id "${d.id}"`,
    );
    assert(
        typeof parsedKeys[d.id] === 'string' && parsedKeys[d.id]!.length > 0,
        `__FLOW_LAYOUT_KEYS__["${d.id}"] must be a non-empty string`,
    );
}
console.log(`PASS: window.__FLOW_LAYOUT_KEYS__ is an object with ${Object.keys(parsedKeys).length} entr${Object.keys(parsedKeys).length === 1 ? 'y' : 'ies'}`);

// 6. buildFlowLayoutKeys agrees with the injected map
for (const [id, key] of Object.entries(flowLayoutKeys)) {
    assert(
        parsedKeys[id] === key,
        `__FLOW_LAYOUT_KEYS__["${id}"] in HTML (${parsedKeys[id]}) must match buildFlowLayoutKeys result (${key})`,
    );
}
console.log('PASS: __FLOW_LAYOUT_KEYS__ values match buildFlowLayoutKeys output');

// 7. Live-mode script is stripped
assert(
    !html.includes("window.__IGNATIUS_MODE__ = 'live'"),
    "live-mode script (window.__IGNATIUS_MODE__ = 'live') must be stripped from output",
);
console.log("PASS: live-mode window.__IGNATIUS_MODE__ = 'live' script stripped");

// 8. Bundle is embedded — check for doctype and a bundled script block
assert(
    html.toLowerCase().includes('<!doctype html>'),
    'output must contain <!doctype html>',
);
assert(
    html.includes('<script type="module">'),
    'output must contain an inlined <script type="module"> (bundle embedded)',
);
console.log('PASS: <!doctype html> and inlined module script present');

// 9. __THEME_MODE__ is set
assert(
    html.includes('window.__THEME_MODE__ = "dark"'),
    '__THEME_MODE__ must be set to "dark"',
);
console.log('PASS: window.__THEME_MODE__ = "dark" present');

// 10. __MODEL__ is injected (branding model) — must be a non-trivial JSON object
assert(
    html.includes('window.__MODEL__ ='),
    '__MODEL__ (branding model) must be injected into static flow HTML',
);
console.log('PASS: window.__MODEL__ injection present');

// ---------------------------------------------------------------------------
// Escape test — </script> in a field value must not appear raw in the HTML
// ---------------------------------------------------------------------------

// Build a minimal FlowModel whose process bodyHtml contains </script>.
const SCRIPT_CLOSE = '</script>';
const escapeDiagram: FlowDiagram = {
    id: 'escape-test',
    processes: [
        {
            id: 'Proc-1',
            label: 'Proc 1',
            dottedNumber: '1',
            inputs: [],
            outputs: [],
            body: `see \`${SCRIPT_CLOSE}\` tag`,
            bodyHtml: `<p>see <code>${SCRIPT_CLOSE}</code> tag</p>`,
            hasSubDfd: false,
            flowId: 'escape-test',
        },
    ],
    externals: [],
    storeRefs: [],
    edges: [],
    subDfds: [],
};

const escapeFlowModel: FlowModel = {
    diagrams: [escapeDiagram],
    modelDir: 'test',
};

const escapeKeys = buildFlowLayoutKeys(escapeFlowModel);
const escapeHtml = await generateFlowGraph(escapeFlowModel, model, 'static', {
    flowLayoutKeys: escapeKeys,
    themeMode: 'dark',
});

// (a) The raw </script> from bodyHtml must NOT appear unescaped inside the
//     injection <script> block.
const injectionStart = escapeHtml.indexOf('window.__IGNATIUS_MODE__ = "static"');
assert(injectionStart !== -1, 'escape test: injection block not found in HTML');
const injectionEnd = escapeHtml.indexOf('</script>', injectionStart);
assert(injectionEnd !== -1, 'escape test: closing </script> of injection block not found');
const injectionSlice = escapeHtml.slice(injectionStart, injectionEnd);

assert(
    !injectionSlice.includes(SCRIPT_CLOSE),
    'escape test: raw </script> must NOT appear inside injection block (not escaped)',
);
console.log('PASS: escape test — raw </script> not present in injection block');

// (b) The JSON round-trips: the parsed array gives back the original bodyHtml.
const parsedEscapeArray = extractFlowModelArray(escapeHtml);
assert(Array.isArray(parsedEscapeArray) && parsedEscapeArray.length === 1, 'escape test: __FLOW_MODEL__ must be array of length 1');
const escapedProc = parsedEscapeArray[0]!.processes.find(p => p.id === 'Proc-1');
assert(
    escapedProc !== undefined,
    'escape test: Proc-1 not found in parsed __FLOW_MODEL__[0]',
);
assert(
    escapedProc.bodyHtml.includes(SCRIPT_CLOSE),
    `escape test: bodyHtml must round-trip to contain "${SCRIPT_CLOSE}" after parse`,
);
console.log('PASS: escape test — bodyHtml round-trips correctly through JSON parse');

// ---------------------------------------------------------------------------
// Multi-DFD test — models/key-inherited (order-to-cash + refund)
// ---------------------------------------------------------------------------
// key-inherited now has TWO top-level DFDs. This section confirms that
// generateFlowGraph serialises both diagrams and that buildFlowLayoutKeys
// contains entries for every diagram id (plus any sub-DFD ids within them).

const KI_MODEL_DIR = 'models/key-inherited';
const [{ flowModel: kiFlowModel, globalErrors: kiFlowErrors }, { model: kiModel }] = await Promise.all([
    parseFlows(KI_MODEL_DIR),
    parseModels(KI_MODEL_DIR),
]);

assert(kiFlowErrors.length === 0, `parseFlows key-inherited produced errors: ${JSON.stringify(kiFlowErrors)}`);
assert(
    kiFlowModel.diagrams.length === 2,
    `key-inherited must have 2 top-level DFDs after adding refund, got ${kiFlowModel.diagrams.length}: ${kiFlowModel.diagrams.map(d => d.id).join(', ')}`,
);
console.log(`PASS: key-inherited has ${kiFlowModel.diagrams.length} top-level DFDs: ${kiFlowModel.diagrams.map(d => d.id).join(', ')}`);

const kiIds = new Set(kiFlowModel.diagrams.map(d => d.id));
assert(kiIds.has('order-to-cash'), 'key-inherited diagrams must include order-to-cash');
assert(kiIds.has('refund'), 'key-inherited diagrams must include refund');
console.log('PASS: both order-to-cash and refund present in key-inherited diagrams');

const kiLayoutKeys = buildFlowLayoutKeys(kiFlowModel);

const kiHtml = await generateFlowGraph(kiFlowModel, kiModel, 'static', {
    flowLayoutKeys: kiLayoutKeys,
    themeMode: 'light',
});

const kiParsedArray = extractFlowModelArray(kiHtml);
assert(Array.isArray(kiParsedArray), 'key-inherited __FLOW_MODEL__ must be an array');
assert(
    kiParsedArray.length === 2,
    `key-inherited __FLOW_MODEL__ array must have length 2, got ${kiParsedArray.length}`,
);
console.log(`PASS: key-inherited __FLOW_MODEL__ is an array of length ${kiParsedArray.length}`);

const kiParsedKeys = extractFlowLayoutKeys(kiHtml);
assert(
    'order-to-cash' in kiParsedKeys,
    '__FLOW_LAYOUT_KEYS__ must contain entry for order-to-cash',
);
assert(
    typeof kiParsedKeys['order-to-cash'] === 'string' && kiParsedKeys['order-to-cash']!.length > 0,
    '__FLOW_LAYOUT_KEYS__["order-to-cash"] must be a non-empty string',
);
assert(
    'refund' in kiParsedKeys,
    '__FLOW_LAYOUT_KEYS__ must contain entry for refund',
);
assert(
    typeof kiParsedKeys['refund'] === 'string' && kiParsedKeys['refund']!.length > 0,
    '__FLOW_LAYOUT_KEYS__["refund"] must be a non-empty string',
);
console.log('PASS: __FLOW_LAYOUT_KEYS__ contains entries for both order-to-cash and refund');

// The two diagrams must have distinct fingerprints (different topology).
assert(
    kiParsedKeys['order-to-cash'] !== kiParsedKeys['refund'],
    'order-to-cash and refund must have distinct layout keys (different topology)',
);
console.log('PASS: order-to-cash and refund have distinct layout fingerprints');

// buildFlowLayoutKeys agrees with the injected map for all entries.
for (const [id, key] of Object.entries(kiLayoutKeys)) {
    assert(
        kiParsedKeys[id] === key,
        `key-inherited __FLOW_LAYOUT_KEYS__["${id}"] in HTML (${kiParsedKeys[id]}) must match buildFlowLayoutKeys result (${key})`,
    );
}
console.log('PASS: key-inherited __FLOW_LAYOUT_KEYS__ values match buildFlowLayoutKeys output');

console.log('\nAll test-flow-graph-gen assertions PASS');
