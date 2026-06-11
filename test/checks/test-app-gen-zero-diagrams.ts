/**
 * F-7 coverage: generateApp with a FlowModel that has zero diagrams.
 *
 * WHY: generateApp branches on flowModel.diagrams.length > 0 to decide whether
 * to inject __FLOW_MODEL__ / __FLOW_LAYOUT_KEYS__. A flows/ directory that
 * exists but produces zero valid DFDs (e.g. all files have parse errors) is
 * treated identically to no-flows (flowModel passed as null). This test
 * documents and pins that behavior without requiring a real bundle.
 *
 * The stub BundleContent carries the minimal HTML template that the generator
 * pattern-matches to inline the CSS and JS. Real bundle output is not needed
 * to verify the injection block.
 */

import { resolve } from 'path';
import { generateApp } from '../../src/generators/app';
import type { Model } from '../../src/model/parse';
import type { FlowModel } from '../../src/flows/flow-parse';
import type { BundleContent } from '../../src/generators/embedded-bundle';

const ROOT = resolve(import.meta.dir, '../..');

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
    if (cond) {
        console.log(`  PASS  ${label}`);
    } else {
        console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
        failures++;
    }
}

// ── Minimal stub bundle (no real build needed) ────────────────────────────────

const stubBundle: BundleContent = {
    htmlTemplate:
        '<html><head>' +
        '<link rel="stylesheet" href="index-stub.css">' +
        '</head><body>' +
        '<script>window.__IGNATIUS_MODE__ = \'live\';</script>' +
        '<script type="module" src="index-stub.js"></script>' +
        '</body></html>',
    cssContent: '/* stub css */',
    jsContent: '/* stub js */',
};

// ── Minimal model fixture (structure only — no real entities needed) ──────────

const stubModel: Model = {
    groups: {},
    nodes: [],
    edges: [],
    subtypeClusters: [],
    theme: {
        dark: { colors: {}, spacing: {} },
        light: { colors: {}, spacing: {} },
    },
    branding: {
        logo: { dark: null, light: null },
        title: 'Test',
        subtitle: '',
        copyright: { text: '', years: '' },
        poweredBy: false,
    },
};

// ── FlowModel with zero diagrams (flows/ dir exists, all DFDs had parse errors) ──

const emptyFlowModel: FlowModel = {
    diagrams: [],
    modelDir: ROOT,
};

// ── Test: zero-diagrams flowModel behaves like null (no flow globals injected) ──

const html = await generateApp(stubModel, emptyFlowModel, stubBundle);

// Must produce a string (doesn't crash)
assert(typeof html === 'string' && html.length > 0, 'zero-diagrams: returns non-empty HTML string');

// __IGNATIUS_MODE__ must be "static" (live-mode script stripped)
assert(
    html.includes('window.__IGNATIUS_MODE__ = "static"'),
    'zero-diagrams: __IGNATIUS_MODE__ = "static" injected',
);

// __MODEL__ must be present
assert(
    html.includes('window.__MODEL__'),
    'zero-diagrams: __MODEL__ injected (ERD model present)',
);

// __LAYOUT_KEY__ must be present (ERD position restore always included)
assert(
    html.includes('window.__LAYOUT_KEY__'),
    'zero-diagrams: __LAYOUT_KEY__ injected (ERD fingerprint always present)',
);

// __THEME_MODE__ must be present
assert(
    html.includes('window.__THEME_MODE__'),
    'zero-diagrams: __THEME_MODE__ injected',
);

// __FLOW_MODEL__ must NOT be injected (zero diagrams → same as null)
assert(
    !html.includes('window.__FLOW_MODEL__'),
    'zero-diagrams: __FLOW_MODEL__ NOT injected (zero diagrams treated as no-flows)',
    `Found __FLOW_MODEL__ in injection — expected omission for empty diagrams array`,
);

// __FLOW_LAYOUT_KEYS__ must NOT be injected
assert(
    !html.includes('window.__FLOW_LAYOUT_KEYS__'),
    'zero-diagrams: __FLOW_LAYOUT_KEYS__ NOT injected (zero diagrams treated as no-flows)',
);

// The live-mode body script must be stripped so static injection wins
assert(
    !html.includes("window.__IGNATIUS_MODE__ = 'live'"),
    'zero-diagrams: live-mode script stripped from body',
);

// ── Done ─────────────────────────────────────────────────────────────────────

console.log('\n' + (failures === 0
    ? 'All zero-diagrams app-generator tests passed.'
    : `${failures} zero-diagrams app-generator test(s) FAILED.`));
if (failures > 0) process.exit(1);
