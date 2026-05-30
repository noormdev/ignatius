/**
 * CP-5 branding verification for the graph generator.
 *
 * The graph is a self-contained React app with window.__MODEL__ baked in.
 * Since CP-3 wired branding into App.tsx, the static graph output renders
 * branding automatically — IF model.branding is included in JSON.stringify(model).
 * This test asserts that it is.
 */
import { parseModels } from '../../src/parse';
import { generateGraph } from '../../src/generators/graph';
import { mergeBranding } from '../../src/branding-defaults';
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

const { model } = await parseModels('models/key-inherited');

// ── Test 1: Generated graph HTML contains embedded data URI logo ──────────────
const darkHtml = await generateGraph(model, 'dark');
assert(
    darkHtml.includes('data:image/svg+xml;base64,'),
    'Default dark graph: output contains embedded data URI logo',
);

const lightHtml = await generateGraph(model, 'light');
assert(
    lightHtml.includes('data:image/svg+xml;base64,'),
    'Default light graph: output contains embedded data URI logo',
);

// ── Test 2: window.__MODEL__ JSON contains a branding object ─────────────────
// Extract the JSON object following `window.__MODEL__ = ` using a brace counter
// so the extraction is not fragile against multi-line or nested structures.
const modelMarker = 'window.__MODEL__ = ';
const markerIdx = darkHtml.indexOf(modelMarker);
assert(markerIdx !== -1, 'dark graph: window.__MODEL__ assignment found');

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
        assert(true, 'dark graph: window.__MODEL__ JSON is valid and parseable');
    } catch {
        assert(false, 'dark graph: window.__MODEL__ JSON is valid and parseable');
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
const customHtml = await generateGraph(customModel, 'dark');
assert(
    customHtml.includes('"Acme Schema"'),
    'Custom title "Acme Schema" present in graph window.__MODEL__',
);

// ── Screenshots ───────────────────────────────────────────────────────────────

// Write custom-branding graph for light mode screenshot
const customLightModel = {
    ...model,
    branding: mergeBranding({ title: 'Acme Schema', subtitle: 'Your data, beautifully mapped', poweredBy: false }),
};

await Bun.write('tmp/cp5-default-graph.html', darkHtml);
const customLightHtml = await generateGraph(customLightModel, 'light');
await Bun.write('tmp/cp5-custom-graph-light.html', customLightHtml);

console.log('\n--- Launching Playwright for screenshot verification ---\n');

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

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
