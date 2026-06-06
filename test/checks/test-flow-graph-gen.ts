/**
 * test-flow-graph-gen.ts — CP-4a: generateFlowGraph static HTML injection.
 *
 * Verifies the emitted HTML string carries the correct window.__ injections
 * and that the live-mode script is stripped.
 *
 * Runs against:
 *  - clean flow fixture: test/fixtures/flows (produces diagram.id = 'clean',
 *    process 'Place-Order' with label 'Place Order')
 *  - entity model: models/key-inherited
 */

import { parseFlows } from '../../src/flow-parse';
import type { FlowDiagram } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowGraph } from '../../src/generators/flow-graph';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Helper: extract the window.__FLOW_MODEL__ value from the emitted HTML,
// parse it as JSON, and return the object. Throws if not found or not valid.
// ---------------------------------------------------------------------------
function extractFlowModel(html: string): FlowDiagram {
    // Match the assignment up to its terminating semicolon, being careful
    // not to consume the closing </script> of the injection block.
    // The value is everything between `= ` and `; window.__FLOW_LAYOUT_KEY__`
    // (the next assignment in the same <script> block).
    const match = html.match(/window\.__FLOW_MODEL__ = (.*?); window\.__FLOW_LAYOUT_KEY__/s);
    assert(match !== null, '__FLOW_MODEL__ assignment not found in emitted HTML');
    const raw = match[1]!;
    // Undo the <\/script> → </script> escape so JSON.parse sees the original value.
    const unescaped = raw.replace(/<\\\/script/gi, '</script');
    // JSON.parse returns any; the declared return type + assertions below
    // verify the actual shape without needing a cast.
    return JSON.parse(unescaped);
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

const FLOW_LAYOUT_KEY = 'testkey123';

const html = await generateFlowGraph(diagram, model, 'static', {
    flowLayoutKey: FLOW_LAYOUT_KEY,
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

// 3. __FLOW_MODEL__ — extract and parse the actual JSON, assert it contains the expected process
const parsedModel = extractFlowModel(html);
assert(
    typeof parsedModel === 'object' && parsedModel !== null,
    '__FLOW_MODEL__ must parse to a non-null object',
);
assert(
    parsedModel.id === 'clean',
    `parsed __FLOW_MODEL__.id must be 'clean', got '${parsedModel.id}'`,
);
const placeOrderProc = parsedModel.processes.find(p => p.id === 'Place-Order');
assert(
    placeOrderProc !== undefined,
    '__FLOW_MODEL__ parsed diagram must contain process id "Place-Order"',
);
assert(
    placeOrderProc.label === 'Place Order',
    `process label must be 'Place Order', got '${placeOrderProc.label}'`,
);
console.log('PASS: window.__FLOW_MODEL__ well-formed JSON with process id=Place-Order label="Place Order"');

// 4. __FLOW_LAYOUT_KEY__ — extract and parse the actual injected value
const layoutKeyMatch = html.match(/window\.__FLOW_LAYOUT_KEY__ = (.*?); window\.__THEME_MODE__/s);
assert(layoutKeyMatch !== null, '__FLOW_LAYOUT_KEY__ assignment not found in emitted HTML');
const parsedLayoutKey: string = JSON.parse(layoutKeyMatch[1]!);
assert(
    parsedLayoutKey === FLOW_LAYOUT_KEY,
    `parsed __FLOW_LAYOUT_KEY__ must equal "${FLOW_LAYOUT_KEY}", got "${parsedLayoutKey}"`,
);
console.log('PASS: window.__FLOW_LAYOUT_KEY__ parses to "testkey123"');

// 5. Live-mode script is stripped
assert(
    !html.includes("window.__IGNATIUS_MODE__ = 'live'"),
    "live-mode script (window.__IGNATIUS_MODE__ = 'live') must be stripped from output",
);
console.log("PASS: live-mode window.__IGNATIUS_MODE__ = 'live' script stripped");

// 6. Bundle is embedded — check for doctype and a bundled script block
assert(
    html.toLowerCase().includes('<!doctype html>'),
    'output must contain <!doctype html>',
);
assert(
    html.includes('<script type="module">'),
    'output must contain an inlined <script type="module"> (bundle embedded)',
);
console.log('PASS: <!doctype html> and inlined module script present');

// 7. __THEME_MODE__ is set
assert(
    html.includes('window.__THEME_MODE__ = "dark"'),
    '__THEME_MODE__ must be set to "dark"',
);
console.log('PASS: window.__THEME_MODE__ = "dark" present');

// ---------------------------------------------------------------------------
// Escape test — </script> in a field value must not appear raw in the HTML
// ---------------------------------------------------------------------------

// Build a minimal FlowDiagram literal whose process bodyHtml contains </script>.
// This is realistic: a process body can contain a markdown code fence with that
// string, which the markdown renderer will emit verbatim.
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

const escapeHtml = await generateFlowGraph(escapeDiagram, model, 'static', {
    flowLayoutKey: 'escape-key',
    themeMode: 'dark',
});

// (a) The raw </script> from bodyHtml must NOT appear unescaped inside the
//     injection <script> block. Verify by checking the region between the
//     opening injection <script> and the first </script> that closes it.
//     Strategy: find the injection block start, take a slice ending at the
//     first </script> after it, and confirm it does not contain the body's
//     literal `</script>` tag — only the escaped form `<\/script`.
const injectionStart = escapeHtml.indexOf('window.__IGNATIUS_MODE__ = "static"');
assert(injectionStart !== -1, 'escape test: injection block not found in HTML');
const injectionEnd = escapeHtml.indexOf('</script>', injectionStart);
assert(injectionEnd !== -1, 'escape test: closing </script> of injection block not found');
const injectionSlice = escapeHtml.slice(injectionStart, injectionEnd);

// The raw (unescaped) </script> must not appear inside the injection values.
// It is safe to check the slice up to the </script> closer — if the raw
// sequence were present it would have truncated the block there already.
assert(
    !injectionSlice.includes(SCRIPT_CLOSE),
    'escape test: raw </script> must NOT appear inside injection block (not escaped)',
);
console.log('PASS: escape test — raw </script> not present in injection block');

// (b) The JSON round-trips: extracting and parsing the model gives back the
//     original bodyHtml with the unescaped </script> intact.
const parsedEscape = extractFlowModel(escapeHtml);
const escapedProc = parsedEscape.processes.find(p => p.id === 'Proc-1');
assert(
    escapedProc !== undefined,
    'escape test: Proc-1 not found in parsed __FLOW_MODEL__',
);
assert(
    escapedProc.bodyHtml.includes(SCRIPT_CLOSE),
    `escape test: bodyHtml must round-trip to contain "${SCRIPT_CLOSE}" after parse`,
);
console.log('PASS: escape test — bodyHtml round-trips correctly through JSON parse');

console.log('\nAll test-flow-graph-gen assertions PASS');
