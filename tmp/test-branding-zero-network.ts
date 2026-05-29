/**
 * Zero-network verification for default-branding static HTML outputs.
 *
 * Loads dict and graph HTML files via file:// URL with Playwright configured
 * to abort ALL http:// and https:// requests. The test passes only if:
 *   - The page loads without any external network requests
 *   - The rendered DOM contains the expected title, footer copyright, and
 *     an <img> whose src starts with "data:" (the embedded logo)
 *   - No <img> has a non-data src (which would imply a missed runtime fetch)
 *
 * This test would fail if the SVG logo were fetched at runtime instead of
 * being embedded as a base64 data URI at generation time.
 */
import { parseModels } from '../src/parse';
import { generateDict } from '../src/generators/dict';
import { generateGraph } from '../src/generators/graph';
import { defaultBranding } from '../src/branding-defaults';
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

// ── Setup: generate default-branding dict + graph HTML ───────────────────────

const baseModel = await parseModels('models');
const defaultModel = { ...baseModel, branding: defaultBranding };

const dictHtml = await generateDict(defaultModel, 'dark', { modelsDir: 'models' });
const graphHtml = await generateGraph(defaultModel, 'dark');

const dictPath = resolve('tmp/zero-network-dict.html');
const graphPath = resolve('tmp/zero-network-graph.html');

await Bun.write(dictPath, dictHtml);
await Bun.write(graphPath, graphHtml);

// ── Playwright verification ───────────────────────────────────────────────────

const browser = await chromium.launch();

async function verifyZeroNetwork(htmlPath: string, surface: 'dict' | 'graph') {
    const page = await browser.newPage();

    const blockedUrls: string[] = [];
    const allowedUrls: string[] = [];

    // Intercept all navigations and sub-resource requests
    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('file://') || url.startsWith('data:')) {
            allowedUrls.push(url);
            return route.continue();
        }
        // Any external http/https → record and abort
        blockedUrls.push(url);
        return route.abort();
    });

    // Also track attempted requests before routing kicks in
    const attemptedExternal: string[] = [];
    page.on('request', (req) => {
        const url = req.url();
        if (!url.startsWith('file://') && !url.startsWith('data:')) {
            attemptedExternal.push(url);
        }
    });

    await page.goto(`file://${htmlPath}`);

    // Wait for DOM to settle
    await page.waitForLoadState('domcontentloaded');

    // ── Assertion 1: No external requests were attempted ─────────────────────
    assert(
        blockedUrls.length === 0,
        `${surface}: no external requests blocked (blocked: ${blockedUrls.join(', ') || 'none'})`,
    );
    assert(
        attemptedExternal.length === 0,
        `${surface}: no external URLs attempted (attempted: ${attemptedExternal.join(', ') || 'none'})`,
    );

    // ── Assertion 2: Title "Noorm Ignatius" is present in DOM ─────────────────
    if (surface === 'dict') {
        const titleText = await page.locator('.dict-branding-title').first().textContent();
        assert(
            titleText?.includes('Noorm Ignatius') ?? false,
            `${surface}: .dict-branding-title contains "Noorm Ignatius" (got: "${titleText}")`,
        );

        // ── Assertion 3: Footer copyright is present ──────────────────────────
        const footerText = await page.locator('.dict-footer-copyright').first().textContent();
        assert(
            footerText?.includes('Noorm Ignatius') ?? false,
            `${surface}: .dict-footer-copyright contains "Noorm Ignatius" (got: "${footerText}")`,
        );
    } else {
        // Graph surface uses .branding-title and .branding-copyright
        const titleText = await page.locator('.branding-title').first().textContent();
        assert(
            titleText?.includes('Noorm Ignatius') ?? false,
            `${surface}: .branding-title contains "Noorm Ignatius" (got: "${titleText}")`,
        );

        const footerText = await page.locator('.branding-copyright').first().textContent();
        assert(
            footerText?.includes('Noorm Ignatius') ?? false,
            `${surface}: .branding-copyright contains "Noorm Ignatius" (got: "${footerText}")`,
        );
    }

    // ── Assertion 4: At least one <img> with data: src exists ─────────────────
    const dataImgCount = await page.locator('img[src^="data:"]').count();
    assert(
        dataImgCount > 0,
        `${surface}: at least one <img src="data:..."> (found ${dataImgCount})`,
    );

    // ── Assertion 5: No <img> with a non-data src ─────────────────────────────
    // Selects any img whose src doesn't start with "data:" AND isn't empty
    // CSS :not() can't handle prefix checks, so use evaluate
    const nonDataImgs = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs
            .filter((img) => img.src && !img.src.startsWith('data:'))
            .map((img) => img.src);
    });
    assert(
        nonDataImgs.length === 0,
        `${surface}: no <img> with non-data src (found: ${nonDataImgs.join(', ') || 'none'})`,
    );

    await page.close();
}

try {
    console.log('\n--- dict: zero-network verification ---\n');
    await verifyZeroNetwork(dictPath, 'dict');

    console.log('\n--- graph: zero-network verification ---\n');
    await verifyZeroNetwork(graphPath, 'graph');
} finally {
    await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED (10 assertions)' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
