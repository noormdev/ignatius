/**
 * Verifies that generateApp injects window.__LAYOUT_KEY__ into the static HTML output.
 *
 * Uses a minimal fake BundleContent so no built bundle is needed on disk.
 * The fake template mimics what loadBundleFromDir returns: an index.html with
 * a <link> pointing to index-abc123.css and a <script type="module"> pointing
 * to index-abc123.js — matching the regexes in generateApp exactly.
 *
 * CP8b: generateGraph is deleted; migrated to generateApp (which calls the same
 * injection helpers and produces the same __LAYOUT_KEY__ injection).
 */
import { generateApp } from '../../src/generators/app';
import type { BundleContent } from '../../src/generators/embedded-bundle';
import { layoutFingerprint } from '../../src/layout-fingerprint';
import { mergeTheme } from '../../src/theme-defaults';
import { mergeBranding } from '../../src/branding-defaults';
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
            group: 'core',
            classification: 'independent',
            pk: ['customer_id'],
            columns: { customer_id: { type: 'uuid' } },
            alternateKeys: [],
            bodyHtml: '',
        },
        {
            id: 'Order',
            group: 'core',
            classification: 'dependent',
            pk: ['order_id'],
            columns: { order_id: { type: 'uuid' } },
            alternateKeys: [],
            bodyHtml: '',
        },
    ],
    edges: [
        {
            source: 'Customer',
            target: 'Order',
            cardinality: { parent: '1', child: 'many' },
            identifying: false,
            on: { customer_id: 'customer_id' },
            predicate: { fwd: 'places', rev: 'placed by' },
        },
    ],
    subtypeClusters: [],
    theme: mergeTheme({}),
    branding: mergeBranding({ poweredBy: false }),
};

// Fake bundle that satisfies generateApp's regex patterns.
// The <link> and <script> tags must match the regexes:
//   /<link rel="stylesheet"[^>]*href="[^"]*index-[^"]+\.css"[^>]*>/
//   /<script type="module"[^>]*src="[^"]*index-[^"]+\.js"[^>]*><\/script>/
const fakeBundle: BundleContent = {
    htmlTemplate: `<!doctype html><html><head><link rel="stylesheet" href="index-abc123.css"></head><body><script>window.__IGNATIUS_MODE__ = 'live';</script><script type="module" src="index-abc123.js"></script></body></html>`,
    cssContent: 'body { margin: 0; }',
    jsContent: 'console.log("app");',
};

const html = await generateApp(model, null, fakeBundle, { themeMode: 'dark' });

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
