/**
 * Verifies that generateGraph injects window.__LAYOUT_KEY__ into the static HTML output.
 *
 * Uses a minimal fake BundleContent so no built bundle is needed on disk.
 * The fake template mimics what loadBundleFromDir returns: an index.html with
 * a <link> pointing to index-abc123.css and a <script type="module"> pointing
 * to index-abc123.js — matching the regexes in generateGraph exactly.
 */
import { generateGraph, type BundleContent } from '../../src/generators/graph';
import { layoutFingerprint } from '../../src/layout-fingerprint';
import type { Model } from '../../src/parse';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failures++;
    } else {
        console.log(`PASS: ${msg}`);
    }
}

// Minimal model with two nodes and one edge — enough for a non-trivial fingerprint
const model: Model = {
    groups: {},
    nodes: [
        {
            id: 'Customer',
            label: 'Customer',
            group: 'core',
            classification: 'independent',
            pk: [{ name: 'customer_id', type: 'uuid' }],
            columns: {},
            ak: [],
            relationships: [],
            body: '',
            bodyHtml: '',
        },
        {
            id: 'Order',
            label: 'Order',
            group: 'core',
            classification: 'dependent',
            pk: [{ name: 'order_id', type: 'uuid' }],
            columns: {},
            ak: [],
            relationships: [],
            body: '',
            bodyHtml: '',
        },
    ],
    edges: [
        {
            source: 'Customer',
            target: 'Order',
            label: 'places',
            cardinality: 'one-to-many',
            identifying: 'false',
            fkColumn: '',
            nullable: false,
            predicate: { fwd: 'places', rev: 'placed by' },
        },
    ],
    subtypeClusters: [],
    theme: {
        dark: {
            background: '#1a1a1a',
            surface: '#2a2a2a',
            border: '#3a3a3a',
            text: '#ffffff',
            textMuted: '#aaaaaa',
            link: '#4488ff',
            groups: {},
        },
        light: {
            background: '#ffffff',
            surface: '#f0f0f0',
            border: '#cccccc',
            text: '#000000',
            textMuted: '#666666',
            link: '#0044cc',
            groups: {},
        },
        spacing: { nodePadding: 12, edgeLength: 120 },
    },
    branding: {
        title: 'Test',
        subtitle: '',
        poweredBy: false,
        logo: { dark: '', light: '' },
        copyright: { text: '', url: '' },
    },
};

// Fake bundle that satisfies generateGraph's regex patterns.
// The <link> and <script> tags must match the regexes:
//   /<link rel="stylesheet"[^>]*href="[^"]*index-[^"]+\.css"[^>]*>/
//   /<script type="module"[^>]*src="[^"]*index-[^"]+\.js"[^>]*><\/script>/
const fakeBundle: BundleContent = {
    htmlTemplate: `<!doctype html><html><head><link rel="stylesheet" href="index-abc123.css"></head><body><script>window.__IGNATIUS_MODE__ = 'live';</script><script type="module" src="index-abc123.js"></script></body></html>`,
    cssContent: 'body { margin: 0; }',
    jsContent: 'console.log("app");',
};

const html = await generateGraph(model, 'dark', fakeBundle);

// 1. __LAYOUT_KEY__ is present in the output
assert(html.includes('window.__LAYOUT_KEY__'), 'output contains window.__LAYOUT_KEY__');

// 2. The key is non-empty (not an empty string literal)
const keyMatch = html.match(/window\.__LAYOUT_KEY__\s*=\s*"([^"]+)"/);
assert(keyMatch !== null, 'window.__LAYOUT_KEY__ has a non-empty quoted string value');

// 3. The injected key matches what layoutFingerprint would produce for the same model
const expectedKey = layoutFingerprint(model);
assert(keyMatch?.[1] === expectedKey, `injected key "${keyMatch?.[1]}" matches layoutFingerprint("${expectedKey}")`);

// 4. __LAYOUT_KEY__ appears before the <script type="module"> (inside the synchronous injection)
const layoutKeyIdx = html.indexOf('window.__LAYOUT_KEY__');
const moduleIdx = html.indexOf('<script type="module"');
assert(layoutKeyIdx !== -1 && moduleIdx !== -1 && layoutKeyIdx < moduleIdx,
    '__LAYOUT_KEY__ injection appears before <script type="module">');

// 5. __MODEL__ is still present (injection not broken)
assert(html.includes('window.__MODEL__'), 'window.__MODEL__ still present in output');

// 6. __IGNATIUS_MODE__ = "static" is still present
assert(html.includes('window.__IGNATIUS_MODE__ = "static"'), 'window.__IGNATIUS_MODE__ = "static" still present');

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
