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
import { parseModels } from '../../src/parse';
import { generateDict } from '../../src/generators/dict';
import { generateGraph } from '../../src/generators/graph';
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
// parseModels with no _branding.yaml naturally defaults — exercises the full parse→merge path.

const model = await parseModels('models');

const dictHtml = await generateDict(model, 'dark', { modelsDir: 'models' });
const graphHtml = await generateGraph(model, 'dark');

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
        // Graph surface uses .branding-title and .branding-copyright.
        // React renders client-side — wait for the element before reading.
        await page.waitForSelector('.branding-title', { timeout: 30000 });
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
    console.log('\n--- dict: zero-network verification (dev imports) ---\n');
    await verifyZeroNetwork(dictPath, 'dict');

    console.log('\n--- graph: zero-network verification (dev imports) ---\n');
    await verifyZeroNetwork(graphPath, 'graph');

    // ── Binary verification (F-15) ──────────────────────────────────────────
    // Spawn the compiled binary to catch bundling defects (e.g. dropped embedded SVG).
    console.log('\n--- binary zero-network verification ---\n');

    const binaryDictPath = resolve('tmp/zero-network-binary-dict.html');
    const binaryGraphPath = resolve('tmp/zero-network-binary-graph.html');

    const dictProc = Bun.spawn(['./dist/ignatius', 'dict', 'models', '-o', binaryDictPath], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    await dictProc.exited;
    if (dictProc.exitCode !== 0) {
        const err = await new Response(dictProc.stderr).text();
        assert(false, `binary dict: exited ${dictProc.exitCode} — ${err.trim()}`);
    } else {
        console.log('PASS: binary dict: exited 0');
    }

    const graphProc = Bun.spawn(['./dist/ignatius', 'graph', 'models', '-o', binaryGraphPath], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    await graphProc.exited;
    if (graphProc.exitCode !== 0) {
        const err = await new Response(graphProc.stderr).text();
        assert(false, `binary graph: exited ${graphProc.exitCode} — ${err.trim()}`);
    } else {
        console.log('PASS: binary graph: exited 0');
    }

    const binaryDictExists = await Bun.file(binaryDictPath).exists();
    const binaryGraphExists = await Bun.file(binaryGraphPath).exists();
    assert(binaryDictExists, 'binary dict: output file created');
    assert(binaryGraphExists, 'binary graph: output file created');

    if (binaryDictExists) {
        console.log('\n--- binary dict: zero-network verification ---\n');
        await verifyZeroNetwork(binaryDictPath, 'dict');
    }
    if (binaryGraphExists) {
        console.log('\n--- binary graph: zero-network verification ---\n');
        await verifyZeroNetwork(binaryGraphPath, 'graph');
    }
} finally {
    await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
