/**
 * Zero-network verification for default-branding static HTML outputs.
 *
 * Loads the export HTML file via file:// URL with Playwright configured
 * to abort ALL http:// and https:// requests. The test passes only if:
 *   - The page loads without any external network requests
 *   - The rendered DOM contains the expected title, footer copyright, and
 *     an <img> whose src starts with "data:" (the embedded logo)
 *   - No <img> has a non-data src (which would imply a missed runtime fetch)
 *
 * This test would fail if the SVG logo were fetched at runtime instead of
 * being embedded as a base64 data URI at generation time.
 *
 * CP8b: generateDict is deleted (serve no longer generates static dict HTML).
 * Only the `export` output is verified here; the binary section uses `export`.
 */
import { parseModels } from '../../src/parse';
import { generateApp } from '../../src/generators/app';
import { loadBundleFromDir } from '../../src/generators/embedded-bundle';
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failures++;
    } else {
        console.log(`PASS: ${msg}`);
    }
}

// ── Setup: generate default-branding dict + export HTML ──────────────────────
// parseModels with no _branding.yaml naturally defaults — exercises the full parse→merge path.

const ROOT = resolve(import.meta.dir, '../..');
const { model } = await parseModels('models/key-inherited');

// Load the bundle for generateApp — skip export verification if not built.
const bundleIndexPath = join(ROOT, 'dist/static/index.js');
const bundleBuilt = await Bun.file(bundleIndexPath).exists();

let exportHtml: string | null = null;
if (bundleBuilt) {
  const bundle = await loadBundleFromDir(join(ROOT, 'dist/static'));
  exportHtml = await generateApp(model, null, bundle, { themeMode: 'dark' });
}

const exportPath = resolve('tmp/zero-network-export.html');

if (exportHtml !== null) {
  await Bun.write(exportPath, exportHtml);
}

// ── Playwright verification ───────────────────────────────────────────────────

const browser = await chromium.launch();

async function verifyZeroNetwork(htmlPath: string, surface: 'export') {
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
    // Export (unified app) surface uses .branding-title and .branding-copyright.
    // React renders client-side — wait for the element before reading.
    await page.waitForSelector('.branding-title', { timeout: 30000 });
    const titleText = await page.locator('.branding-title').first().textContent();
    assert(
        titleText?.includes('Noorm Ignatius') ?? false,
        `${surface}: .branding-title contains "Noorm Ignatius" (got: "${titleText}")`,
    );

    // ── Assertion 3: Footer copyright is present ──────────────────────────
    const footerText = await page.locator('.branding-copyright').first().textContent();
    assert(
        footerText?.includes('Noorm Ignatius') ?? false,
        `${surface}: .branding-copyright contains "Noorm Ignatius" (got: "${footerText}")`,
    );

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
    if (exportHtml !== null) {
        console.log('\n--- export: zero-network verification (dev imports) ---\n');
        await verifyZeroNetwork(exportPath, 'export');
    } else {
        console.log('  SKIP  export: zero-network verification (bundle not built)');
    }

    // ── Binary verification (F-15) ──────────────────────────────────────────
    // Spawn the compiled binary to catch bundling defects (e.g. dropped embedded SVG).
    console.log('\n--- binary zero-network verification ---\n');

    const binaryExists = await Bun.file(join(ROOT, 'dist/ignatius')).exists();
    if (!binaryExists) {
        console.log('  SKIP  binary verification: dist/ignatius not built');
    } else {
        const binaryExportPath = resolve('tmp/zero-network-binary-export.html');

        const dictProc = Bun.spawn(['./dist/ignatius', 'dict', 'models/key-inherited', '-o', 'tmp/zero-network-binary-dict.html'], {
            cwd: ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        await dictProc.exited;
        // dict is now a stub — expect exit 1 with the helpful error message.
        if (dictProc.exitCode === 1) {
            const errText = await new Response(dictProc.stderr).text();
            if (errText.includes('export')) {
                console.log('PASS: binary dict: correctly exits 1 with pointer to export');
            } else {
                assert(false, `binary dict stub: stderr should mention 'export', got: ${errText.trim()}`);
            }
        } else {
            assert(false, `binary dict stub: expected exit 1, got ${dictProc.exitCode}`);
        }

        const exportProc = Bun.spawn(['./dist/ignatius', 'export', 'models/key-inherited', '-o', binaryExportPath], {
            cwd: ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        await exportProc.exited;
        if (exportProc.exitCode !== 0) {
            const err = await new Response(exportProc.stderr).text();
            assert(false, `binary export: exited ${exportProc.exitCode} — ${err.trim()}`);
        } else {
            console.log('PASS: binary export: exited 0');
        }

        const binaryExportExists = await Bun.file(binaryExportPath).exists();
        assert(binaryExportExists, 'binary export: output file created');

        if (binaryExportExists) {
            console.log('\n--- binary export: zero-network verification ---\n');
            await verifyZeroNetwork(binaryExportPath, 'export');
        }
    }
} finally {
    await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
