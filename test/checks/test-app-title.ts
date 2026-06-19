/**
 * CP1 (viewer-ux-polish): static-export HTML <title> reflects the model name.
 *
 * WHY: the bundle template hardcodes <title>Ignatius</title>. A served/exported
 * model named "Foo" should produce <title>Foo</title> so tabs and bookmarks are
 * distinguishable; a nameless model falls back to "Ignatius". The model name is
 * HTML text content, so generateApp must HTML-escape it (a name can contain
 * '&', '<', '>') — escaping that is distinct from escapeScriptClose (script-body
 * escaping). This test pins the rewrite without needing the real React bundle:
 * the stub template carries the same <title>Ignatius</title> the real bundle
 * carries, which is the only part of the template the title rewrite touches.
 */

import { resolve } from 'path';
import { generateApp } from '../../src/generators/app';
import type { Model } from '../../src/model/parse';
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

// ── Stub bundle carrying the real template's hardcoded <title> ────────────────

function makeStubBundle(titleText: string = 'Ignatius'): BundleContent {
    return {
        htmlTemplate:
            '<!DOCTYPE html><html lang="en"><head>' +
            '<meta charset="UTF-8" />' +
            `<title>${titleText}</title>` +
            '<link rel="stylesheet" href="index-stub.css">' +
            '</head><body>' +
            '<div id="root"></div>' +
            '<script>window.__IGNATIUS_MODE__ = \'live\';</script>' +
            '<script type="module" src="index-stub.js"></script>' +
            '</body></html>',
        cssContent: '/* stub css */',
        jsContent: '/* stub js */',
    };
}

// ── Model fixture factory (name is the only thing that varies) ────────────────

function makeModel(name?: string): Model {
    return {
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
        ...(name !== undefined ? { _meta: { name } } : {}),
    };
}

// ── Test 1: named model → <title>Foo</title> ──────────────────────────────────

const namedHtml = await generateApp(makeModel('Foo'), null, makeStubBundle());

assert(
    namedHtml.includes('<title>Foo</title>'),
    'named model: <title>Foo</title> emitted',
    `Expected <title>Foo</title> in output`,
);
assert(
    !namedHtml.includes('<title>Ignatius</title>'),
    'named model: hardcoded <title>Ignatius</title> replaced',
);

// ── Test 2: nameless model → fallback <title>Ignatius</title> ─────────────────
// Use a DISTINCT placeholder title in the stub so this proves the rewrite
// actually ran (placeholder replaced) AND applied the fallback — not merely
// that the template already said "Ignatius" (which a no-op would also pass).

const namelessHtml = await generateApp(
    makeModel(undefined),
    null,
    makeStubBundle('PLACEHOLDER_TITLE'),
);

assert(
    namelessHtml.includes('<title>Ignatius</title>'),
    'nameless model: falls back to <title>Ignatius</title>',
    `Expected fallback <title>Ignatius</title> in output`,
);
assert(
    !namelessHtml.includes('PLACEHOLDER_TITLE'),
    'nameless model: stub placeholder title replaced (rewrite ran, not a no-op)',
);

// ── Test 3: name with HTML metacharacters is escaped as text content ──────────

const escHtml = await generateApp(makeModel('A & B <Co>'), null, makeStubBundle());

assert(
    escHtml.includes('<title>A &amp; B &lt;Co&gt;</title>'),
    'special chars: name HTML-escaped in <title>',
    `Expected <title>A &amp; B &lt;Co&gt;</title> in output`,
);
assert(
    !escHtml.includes('<title>A & B <Co></title>'),
    'special chars: raw < and & not emitted into <title>',
);

// ── Test 4 (smoke): real embedded bundle also gets the title rewritten ────────
// Skips if the bundle isn't built, so CI without a prior build:bundle still passes.

const { loadBundleFromDir } = await import('../../src/generators/embedded-bundle');
const distStatic = resolve(ROOT, 'dist/static');
const bundleHtmlPresent = await Bun.file(resolve(distStatic, 'index.html')).exists();

if (bundleHtmlPresent) {
    const realHtml = await generateApp(makeModel('Foo'), null, await loadBundleFromDir(distStatic));
    assert(
        realHtml.includes('<title>Foo</title>'),
        'real bundle: <title>Foo</title> emitted',
    );
} else {
    console.log('  SKIP  real bundle: dist/static/index.html absent (run build:bundle)');
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('\n' + (failures === 0
    ? 'All app-title tests passed.'
    : `${failures} app-title test(s) FAILED.`));
if (failures > 0) process.exit(1);
