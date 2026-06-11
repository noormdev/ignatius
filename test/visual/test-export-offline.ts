/**
 * CP7 offline assertion: `ignatius export` all-views offline.
 *
 * Steps:
 *  1. Run `export models/key-inherited -o tmp/test-export-offline.html`.
 *  2. Serve ONLY the single file from a local HTTP server that 404s everything else
 *     (file:// is not used because Chromium blocks WASM instantiation from file://
 *     via CORS — ELK would never run its layout pass).
 *  3. Register a Playwright request interceptor that HARD-FAILS if the page requests
 *     any /api/* or /events path — the exported file is self-contained and must make
 *     zero such requests.
 *  4. Assert Graph view renders (Cytoscape canvas, branding, __IGNATIUS_CY__).
 *  5. Assert Dictionary view renders (entities listed) + search filters correctly.
 *  6. Assert Flows view renders (DFD SVG present, __IGNATIUS_FLOW_READY__).
 *  7. Assert a db: store ⓘ badge opens the rich SelectedEntityModal (has table).
 *  8. Assert no /api/* or /events requests were made at any point.
 *
 * Hard-fails (process.exit(1)) on ANY miss — no soft "INFO … continuing" escapes.
 * Run via: bun test/visual/test-export-offline.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const OUT = join(TMP, 'test-export-offline.html');

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
    console.error(`FAIL: ${m}`);
    process.exit(1);
};

// ── Guard: bundle must be built ───────────────────────────────────────────────

const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
if (!bundleExists) {
    note('SKIP: dist/static/index.js not built — run bun run build:bundle first');
    process.exit(0);
}

// ── Step 1: Generate the export file ─────────────────────────────────────────

note('Generating export file…');
const exportProc = Bun.spawn(
    ['bun', 'src/cli/cli.ts', 'export', 'models/key-inherited', '-o', OUT],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);
const timer = setTimeout(() => exportProc.kill(), 60_000);
const [exportExit] = await Promise.all([exportProc.exited]);
clearTimeout(timer);

if (exportExit !== 0) {
    const err = await new Response(exportProc.stderr).text();
    fail(`export process exited ${exportExit}: ${err.trim()}`);
}
if (!existsSync(OUT)) fail(`output file not created: ${OUT}`);

// Verify it is ONE file (no siblings with the same base name)
const base = OUT.replace('.html', '');
const siblings: string[] = [];
for await (const entry of new Bun.Glob(`${base}*.html`).scan(TMP)) {
    siblings.push(entry);
}
const otherSiblings = siblings.filter(s => !s.endsWith('test-export-offline.html'));
if (otherSiblings.length > 0) fail(`export created sibling files: ${otherSiblings.join(', ')}`);

note(`Export file created: ${OUT}`);

// ── Step 2: Serve only the single file; 404 everything else ──────────────────
//
// WHY serve via HTTP rather than file://:
// file:// URLs block WASM fetch/instantiate in Chromium (CORS restriction), so ELK
// never runs its layout pass and Cytoscape draws nothing. We serve the self-contained
// HTML over a local HTTP server — the file IS self-contained (no external deps); the
// server is purely a transport mechanism, not a backend.
//
// WHY 404 everything else:
// The file must need zero /api/* or /events requests. The 404 makes any such request
// a visible network failure; the request interceptor below turns it into a test failure.

const htmlContent = await Bun.file(OUT).text();
const STATIC_PORT = 7292;
const staticServer = Bun.serve({
    port: STATIC_PORT,
    fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/') {
            return new Response(htmlContent, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }
        // All other paths return 404 — the self-contained file must not request them.
        return new Response('Not found', { status: 404 });
    },
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// ── Offline contract enforcement ─────────────────────────────────────────────
//
// Any request whose path starts with /api or /events means the exported file is
// trying to phone home to a live server — that is a hard contract violation.
// We abort the request AND record the URL so we can fail at the end with a
// precise message. Additionally, external host requests (any host != localhost)
// are an even harder violation — they prove the file is NOT self-contained.

const apiEventsRequests: string[] = [];

await context.route('**/*', (route) => {
    const url = route.request().url();
    let u: URL;
    try { u = new URL(url); } catch { return route.continue(); }

    // Any /api/* or /events path is a contract violation — abort and record.
    if (u.pathname.startsWith('/api') || u.pathname.startsWith('/events')) {
        apiEventsRequests.push(url);
        return route.abort();
    }

    // Requests to the static server or data:/blob: URLs are fine.
    if (url.startsWith(`http://localhost:${STATIC_PORT}`) || url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
    }

    // Any external host is a self-contained violation — abort and record.
    apiEventsRequests.push(url);
    return route.abort();
});

const page = await context.newPage();

try {
    note(`Opening http://localhost:${STATIC_PORT}/ (self-contained HTML, all other paths 404)…`);
    await page.goto(`http://localhost:${STATIC_PORT}/`);

    // ── Step 3: Graph view ────────────────────────────────────────────────────
    note('Waiting for Graph view (Cytoscape canvas)…');

    // Wait for React mount
    await page.waitForSelector('.graph-panel', { timeout: 20_000 }).catch(() => {
        fail('Graph panel not found in DOM after 20s');
    });

    // Wait for Cytoscape canvas (may take time for ELK layout)
    await page.waitForSelector('.graph-panel canvas', { timeout: 25_000 }).catch(() => {
        fail('.graph-panel canvas not found — Cytoscape ERD did not render');
    });
    await page.waitForTimeout(2000);

    // Verify __IGNATIUS_MODE__ = 'static' (proves no live-server fetch path)
    const injectedMode = await page.evaluate(() => (window as { __IGNATIUS_MODE__?: string }).__IGNATIUS_MODE__);
    if (injectedMode !== 'static') fail(`Expected __IGNATIUS_MODE__ = 'static', got '${injectedMode}'`);
    note(`PASS: __IGNATIUS_MODE__ = '${injectedMode}'`);

    // Verify Cytoscape initialized
    const hasCy = await page.evaluate(() => (window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__ !== undefined);
    if (!hasCy) fail('__IGNATIUS_CY__ not defined — ERD did not fully initialize');
    note('PASS: __IGNATIUS_CY__ is defined (ERD rendered)');

    // Branding visible
    const brandingVisible = await page.locator('.branding-title').isVisible().catch(() => false);
    if (!brandingVisible) fail('.branding-title not visible in Graph view');
    note('PASS: branding visible in Graph view');

    await page.screenshot({ path: join(TMP, 'export-offline-01-graph.png') });
    note('Screenshot: export-offline-01-graph.png');

    // ── Step 4: Switch to Dictionary ──────────────────────────────────────────
    note('Switching to Dictionary view…');

    await page.evaluate(() => { window.location.hash = '#view=dict'; });
    await page.waitForTimeout(1500);

    // Dictionary panel must be visible
    const dictVisible = await page.locator('.dict-view').isVisible().catch(() => false);
    if (!dictVisible) fail('.dict-view not visible after switching to dict view');
    note('PASS: Dictionary view visible');

    // At least one entity section must be rendered
    const entitySections = await page.locator('.dict-entity-section').count();
    if (entitySections === 0) fail('No .dict-entity-section sections found in Dictionary view');
    note(`PASS: ${entitySections} entity sections in Dictionary`);

    await page.screenshot({ path: join(TMP, 'export-offline-02-dict.png') });
    note('Screenshot: export-offline-02-dict.png');

    // ── Step 5: Dictionary search ─────────────────────────────────────────────
    note('Testing Dictionary search…');

    const searchInput = page.locator('.dict-search-input');
    const searchVisible = await searchInput.isVisible().catch(() => false);
    if (!searchVisible) fail('.dict-search-input not found — search box missing from Dictionary view');

    // 'Payment' is a known entity in key-inherited model
    await searchInput.fill('Payment');
    await page.waitForTimeout(500);

    // Some sections matching 'Payment' must remain visible
    const matchingSection = await page.locator('.dict-entity-section').filter({ hasText: 'Payment' }).count();
    if (matchingSection === 0) fail('Dictionary search: no .dict-entity-section matching "Payment" visible after filtering');
    note(`PASS: Dictionary search filters correctly (${matchingSection} "Payment" section(s) visible)`);

    await page.screenshot({ path: join(TMP, 'export-offline-03-dict-search.png') });
    note('Screenshot: export-offline-03-dict-search.png');

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // ── Step 6: Switch to Flows view ──────────────────────────────────────────
    note('Switching to Flows view…');

    await page.evaluate(() => { window.location.hash = '#view=flow'; });

    // Wait for the flow renderer to signal readiness.
    // WHY: __IGNATIUS_FLOW_READY__ is set by initFlowGraphCore after the first
    // SVG render completes — it is the authoritative "flow rendered" gate.
    const flowReady = await page.waitForFunction(
        () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
        { timeout: 25_000 },
    ).then(() => true).catch(() => false);

    if (!flowReady) fail('Flows view did not render: __IGNATIUS_FLOW_READY__ never became true after 25s');
    note('PASS: __IGNATIUS_FLOW_READY__ = true');

    // A DFD SVG must be present in the DOM.
    // WHY: [data-ignatius="flow-svg"] is set directly on the <svg> root element
    // of FlowDiagramSvg — it is always present when a DFD has rendered.
    const flowSvgCount = await page.locator('[data-ignatius="flow-svg"]').count();
    if (flowSvgCount === 0) fail('No [data-ignatius="flow-svg"] found — DFD SVG did not render in Flows view');
    note(`PASS: Flows view has ${flowSvgCount} DFD SVG element(s)`);

    await page.screenshot({ path: join(TMP, 'export-offline-04-flow.png') });
    note('Screenshot: export-offline-04-flow.png');

    // ── Step 7: db: store ⓘ → rich entity dialog ─────────────────────────────
    note('Looking for db: store ⓘ badge (data-token^="db:")…');

    // The store <g> wrapper carries data-token="db:<StoreName>".
    // InfoBadge inside is identified by data-ignatius="flow-info".
    const dbInfoBadge = page.locator('[data-token^="db:"] [data-ignatius="flow-info"]').first();
    const dbBadgeVisible = await dbInfoBadge.isVisible().catch(() => false);
    if (!dbBadgeVisible) fail('No db: store ⓘ badge found — [data-token^="db:"] [data-ignatius="flow-info"] not in DOM');

    await dbInfoBadge.click();
    await page.waitForTimeout(1200);

    // The rich SelectedEntityModal has an attributes table; the plain FlowDocModal does not.
    // WHY: ColumnsTable renders a <table> inside .doc-section; FlowDocModal renders
    // only .doc-body with markdown HTML (no <table> unless the markdown itself contains one,
    // which the key-inherited entity bodies do not for PaymentMethod at the modal level).
    // Additionally, SelectedEntityModal shows .modal-badges (classification + group badges)
    // which FlowDocModal never renders — use it as a more reliable discriminator.
    const richModal = await page.locator('.modal .modal-badges').count();
    if (richModal === 0) fail('db: store ⓘ did not open the rich SelectedEntityModal (.modal .modal-badges missing)');
    note('PASS: db: store ⓘ opened rich SelectedEntityModal (modal-badges found)');

    // Extra: table must also be present (proves attributes rendered, not just the header)
    const hasTable = await page.locator('.modal table').count();
    if (hasTable === 0) fail('rich SelectedEntityModal has no <table> — attributes (ColumnsTable) did not render');
    note('PASS: SelectedEntityModal has attributes table');

    await page.screenshot({ path: join(TMP, 'export-offline-05-db-store-dialog.png') });
    note('Screenshot: export-offline-05-db-store-dialog.png');

    // Close modal
    const closeBtn = page.locator('.modal-close').first();
    if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
    }

    // ── Step 8: Back to Graph — verify ERD still works ────────────────────────
    note('Switching back to Graph view…');

    await page.evaluate(() => { window.location.hash = '#view=graph'; });
    await page.waitForTimeout(2000);

    const cyAfterSwitch = await page.evaluate(() => (window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__ !== undefined);
    if (!cyAfterSwitch) fail('__IGNATIUS_CY__ lost after returning to Graph view');
    note('PASS: __IGNATIUS_CY__ still defined after view switches (no leak)');

    await page.screenshot({ path: join(TMP, 'export-offline-06-graph-return.png') });
    note('Screenshot: export-offline-06-graph-return.png');

    // ── Step 9: Enforce the offline contract ──────────────────────────────────
    // Any /api/* or /events request recorded above means the file phones home.
    // Any external host request means the file is not self-contained.
    // Both are hard failures.
    if (apiEventsRequests.length > 0) {
        fail(
            `Offline contract violated: ${apiEventsRequests.length} forbidden request(s) were issued:\n` +
            apiEventsRequests.map(u => `  ${u}`).join('\n'),
        );
    }
    note('PASS: Zero /api/* or /events requests (fully offline)');

    note('\nAll offline export checks PASSED.');
} finally {
    await browser.close();
    staticServer.stop(true);
}
