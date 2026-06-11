/**
 * CP-5 branding verification for the export generator (generateApp).
 *
 * The export is a self-contained React app with window.__MODEL__ baked in.
 * Since CP-3 wired branding into App.tsx, the static export output renders
 * branding automatically — IF model.branding is included in JSON.stringify(model).
 * This test asserts that it is.
 *
 * CP8b: generateGraph is deleted; migrated to generateApp + fake BundleContent.
 */
import { parseModels } from '../../src/model/parse';
import { generateApp } from '../../src/generators/app';
import { mergeBranding } from '../../src/theme/branding-defaults';
import type { BundleContent } from '../../src/generators/embedded-bundle';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failures++;
    } else {
        console.log(`PASS: ${msg}`);
    }
}

// Fake bundle — satisfies generateApp's CSS/JS regex patterns.
// Mirrors the same trick used in test-layout-key-injection.ts.
const fakeBundle: BundleContent = {
    htmlTemplate: `<!doctype html><html><head><link rel="stylesheet" href="index-abc123.css"></head><body><script>window.__IGNATIUS_MODE__ = 'live';</script><script type="module" src="index-abc123.js"></script></body></html>`,
    cssContent: 'body { margin: 0; }',
    jsContent: 'console.log("app");',
};

const { model } = await parseModels('models/key-inherited');

// ── Test 1: Generated export HTML contains embedded data URI logo ──────────────
const darkHtml = await generateApp(model, null, fakeBundle, { themeMode: 'dark' });
assert(
    darkHtml.includes('data:image/svg+xml;base64,'),
    'Default dark export: output contains embedded data URI logo',
);

const lightHtml = await generateApp(model, null, fakeBundle, { themeMode: 'light' });
assert(
    lightHtml.includes('data:image/svg+xml;base64,'),
    'Default light export: output contains embedded data URI logo',
);

// ── Test 2: window.__MODEL__ JSON contains a branding object ─────────────────
// Extract the JSON object following `window.__MODEL__ = ` using a brace counter
// so the extraction is not fragile against multi-line or nested structures.
const modelMarker = 'window.__MODEL__ = ';
const markerIdx = darkHtml.indexOf(modelMarker);
assert(markerIdx !== -1, 'dark export: window.__MODEL__ assignment found');

let parsedModel: unknown;

if (markerIdx !== -1) {
    const startIdx = darkHtml.indexOf('{', markerIdx + modelMarker.length);
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < darkHtml.length; i++) {
        if (darkHtml[i] === '{') depth++;
        else if (darkHtml[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    const jsonStr = darkHtml.slice(startIdx, endIdx + 1);
    try {
        parsedModel = JSON.parse(jsonStr);
        assert(true, 'dark export: window.__MODEL__ JSON is valid and parseable');
    } catch {
        assert(false, 'dark export: window.__MODEL__ JSON is valid and parseable');
    }
}

if (parsedModel !== undefined && typeof parsedModel === 'object' && parsedModel !== null) {
    assert('branding' in parsedModel, 'window.__MODEL__ has branding key');

    if ('branding' in parsedModel) {
        const branding = (parsedModel as { branding: unknown }).branding;
        if (typeof branding === 'object' && branding !== null) {
            assert(typeof (branding as { title?: unknown }).title === 'string', 'branding.title is a string');
            const logo = (branding as { logo?: unknown }).logo;
            assert(typeof logo === 'object' && logo !== null, 'branding.logo is an object (normalized dark/light shape)');

            if (typeof logo === 'object' && logo !== null) {
                assert(
                    typeof (logo as { dark?: unknown }).dark === 'string' && ((logo as { dark: string }).dark).startsWith('data:image/svg+xml;base64,'),
                    'branding.logo.dark is a data URI',
                );
                assert(
                    typeof (logo as { light?: unknown }).light === 'string' && ((logo as { light: string }).light).startsWith('data:image/svg+xml;base64,'),
                    'branding.logo.light is a data URI',
                );
            }

            assert('poweredBy' in (branding as object), 'branding.poweredBy present');
            assert('copyright' in (branding as object), 'branding.copyright present');

            if ('copyright' in (branding as object)) {
                const copyright = (branding as { copyright: unknown }).copyright;
                if (typeof copyright === 'object' && copyright !== null) {
                    assert(typeof (copyright as { holder?: unknown }).holder === 'string', 'branding.copyright.holder is a string');
                    assert(typeof (copyright as { year?: unknown }).year === 'number', 'branding.copyright.year is a number');
                }
            }
        }
    }
}

// ── Test 3: Custom branding model includes the custom values ──────────────────
const customModel = {
    ...model,
    branding: mergeBranding({ title: 'Acme Schema', poweredBy: false }),
};
const customHtml = await generateApp(customModel, null, fakeBundle, { themeMode: 'dark' });
assert(
    customHtml.includes('"Acme Schema"'),
    'Custom title "Acme Schema" present in export window.__MODEL__',
);

// ── Screenshots ───────────────────────────────────────────────────────────────
// Write custom-branding export for visual inspection (no Playwright screenshot needed
// for the string assertions above — screenshots are the visual test harness's job).
await Bun.write('tmp/cp5-default-graph.html', darkHtml);

const customLightModel = {
    ...model,
    branding: mergeBranding({ title: 'Acme Schema', subtitle: 'Your data, beautifully mapped', poweredBy: false }),
};
const customLightHtml = await generateApp(customLightModel, null, fakeBundle, { themeMode: 'light' });
await Bun.write('tmp/cp5-custom-graph-light.html', customLightHtml);

// Only run Playwright if the bundle is actually on disk (the fake bundle won't render React).
// The string assertions above are the real coverage; the screenshot section is informational.
const ROOT = resolve(import.meta.dir, '../..');
const bundleBuilt = await Bun.file(ROOT + '/dist/static/index.js').exists();
if (bundleBuilt) {
    console.log('\n--- Launching Playwright for screenshot verification ---\n');
    const { loadBundleFromDir } = await import('../../src/generators/embedded-bundle');
    const realBundle = await loadBundleFromDir(ROOT + '/dist/static');
    const realDarkHtml = await generateApp(model, null, realBundle, { themeMode: 'dark' });
    const realCustomLightHtml = await generateApp(customLightModel, null, realBundle, { themeMode: 'light' });
    await Bun.write('tmp/cp5-default-graph.html', realDarkHtml);
    await Bun.write('tmp/cp5-custom-graph-light.html', realCustomLightHtml);

    const browser = await chromium.launch();

    async function screenshotPage(htmlPath: string, outputPath: string, label: string) {
        const absPath = resolve(htmlPath);
        const page = await browser.newPage();
        await page.goto(`file://${absPath}`);
        try {
            await page.waitForSelector('.graph-panel canvas', { timeout: 30000 });
            console.log(`PASS: ${label}: .graph-panel canvas found`);
        } catch {
            const hasPanel = await page.$('.graph-panel');
            assert(hasPanel !== null, `${label}: .graph-panel present in DOM`);
        }
        await page.screenshot({ path: outputPath, fullPage: true });
        console.log(`PASS: ${label}: screenshot saved to ${outputPath}`);
        await page.close();
    }

    await screenshotPage('tmp/cp5-default-graph.html', 'tmp/screenshot-graph-branding-dark.png', 'dark default branding');
    await screenshotPage('tmp/cp5-custom-graph-light.html', 'tmp/screenshot-graph-branding-light.png', 'light custom branding');

    await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
