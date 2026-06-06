/**
 * Visual verification: flow graph renders with the four canonical DFD node shapes.
 *
 * Self-contained: parses the clean fixture, generates static flow HTML,
 * writes it to tmp/, opens it with Playwright, waits for Cytoscape to
 * initialise (window.__IGNATIUS_CY__ is set by initFlowGraph), takes a
 * screenshot, and saves it to tmp/flow-graph.png.
 *
 * NOT run by `bun run test` — manual visual check only, matching the
 * convention of other test/visual/ scripts.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { parseFlows } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowGraph } from '../../src/generators/flow-graph';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'test/fixtures/flows');
const MODELS = join(ROOT, 'models/key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); process.exit(1); };

// ── Parse fixture + entity model ─────────────────────────────────────────────

note('Parsing flow fixture…');
const { flowModel, globalErrors } = await parseFlows(FIXTURE);
if (globalErrors.length > 0) {
    fail(`parseFlows returned globalErrors: ${JSON.stringify(globalErrors)}`);
}
if (flowModel.diagrams.length === 0) {
    fail('parseFlows returned no diagrams');
}

const diagram = flowModel.diagrams[0]!;
note(`Diagram: ${diagram.id} — ${diagram.processes.length} processes, ${diagram.externals.length} externals, ${diagram.storeRefs.length} stores, ${diagram.edges.length} edges`);

note('Parsing entity model…');
const { model: entityModel } = await parseModels(MODELS);

// ── Generate static flow HTML ─────────────────────────────────────────────────

note('Generating flow graph HTML…');
const html = await generateFlowGraph(diagram, entityModel, 'static', {
    flowLayoutKey: 'vis',
});

const htmlPath = join(TMP, 'flow-graph.html');
await Bun.write(htmlPath, html);
note(`Wrote ${htmlPath} (${html.length} bytes)`);

// ── Playwright screenshot ─────────────────────────────────────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let ok = true;

try {
    await page.goto(`file://${htmlPath}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for Cytoscape to initialise — initFlowGraph sets window.__IGNATIUS_CY__
    // on success, so polling for it confirms the flow render path ran.
    const cyReady = await page.waitForFunction(
        () => (window as unknown as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__ !== undefined,
        { timeout: 15_000 },
    ).then(() => true).catch(() => false);

    if (!cyReady) {
        fail('Timed out waiting for window.__IGNATIUS_CY__ — initFlowGraph may not have run');
    }

    // Allow layout to settle
    await page.waitForTimeout(2000);

    // Verify we can find the canvas (Cytoscape renders into a canvas element)
    const canvasCount = await page.locator('canvas').count();
    if (canvasCount === 0) {
        console.error('FAIL: no canvas element found — Cytoscape may not have initialised');
        ok = false;
    } else {
        note(`Canvas elements found: ${canvasCount}`);
    }

    // Verify __IGNATIUS_SURFACE__ was 'flow' (confirms surface dispatch ran correctly)
    const surface = await page.evaluate(() =>
        (window as unknown as { __IGNATIUS_SURFACE__?: string }).__IGNATIUS_SURFACE__
    );
    if (surface !== 'flow') {
        console.error(`FAIL: __IGNATIUS_SURFACE__ = ${JSON.stringify(surface)}, expected "flow"`);
        ok = false;
    } else {
        note(`__IGNATIUS_SURFACE__ = "flow" confirmed`);
    }

    // Verify process nodes are present in Cytoscape
    const nodeCount = await page.evaluate(() => {
        const cy = (window as unknown as { __IGNATIUS_CY__?: { nodes: () => { length: number } } }).__IGNATIUS_CY__;
        if (!cy) return -1;
        return cy.nodes().length;
    });
    if (nodeCount < 1) {
        console.error(`FAIL: expected at least 1 Cytoscape node, got ${nodeCount}`);
        ok = false;
    } else {
        note(`Cytoscape nodes: ${nodeCount}`);
    }

    const screenshotPath = join(TMP, 'flow-graph.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    note(`Screenshot saved to ${screenshotPath}`);

    // Confirm screenshot file exists and is non-trivial
    const stat = Bun.file(screenshotPath);
    const size = stat.size;
    if (size < 1000) {
        console.error(`FAIL: screenshot is suspiciously small (${size} bytes)`);
        ok = false;
    } else {
        note(`Screenshot size: ${size} bytes (non-trivial)`);
    }

} catch (err) {
    fail(err instanceof Error ? err.message : String(err));
} finally {
    await browser.close();
}

if (!ok) {
    console.error('\nflow-graph visual check FAILED.');
    process.exit(1);
}
console.log('\nflow-graph visual check PASSED.');
