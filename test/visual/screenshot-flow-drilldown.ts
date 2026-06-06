/**
 * Visual verification: flow graph drill-down renders sub-DFD client-side.
 *
 * Uses the 3-level flows-leveling fixture (Authenticate → Login → CreateSession).
 * Screenshots:
 *   1. Top level (auth diagram with Authenticate ⤵ affordance) → tmp/flow-drilldown-top.png
 *   2. After simulating a tap/click on the Authenticate process → sub-DFD level
 *      → tmp/flow-drilldown.png
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { parseFlows } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowGraph, buildFlowLayoutKeys } from '../../src/generators/flow-graph';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'test/fixtures/flows-leveling');
const MODELS = join(ROOT, 'models/key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Parse fixture + entity model ─────────────────────────────────────────────

note('Parsing flows-leveling fixture…');
const { flowModel, globalErrors } = await parseFlows(FIXTURE);
if (globalErrors.length > 0) {
    fail(`parseFlows returned globalErrors: ${JSON.stringify(globalErrors)}`);
}
if (flowModel.diagrams.length === 0) {
    fail('parseFlows returned no diagrams');
}

const diagram = flowModel.diagrams.find(d => d.id === 'auth');
if (!diagram) {
    fail(`Diagram 'auth' not found. Available: ${flowModel.diagrams.map(d => d.id).join(', ')}`);
}

note(`Diagram: ${diagram.id} — ${diagram.processes.length} processes, ${diagram.subDfds.length} sub-DFDs`);

// Verify the Authenticate process is drillable
const authProc = diagram.processes.find(p => p.id === 'Authenticate');
if (!authProc?.hasSubDfd) {
    fail(`Authenticate process has hasSubDfd = false — drill-down won't work`);
}

note('Parsing entity model…');
const { model: entityModel } = await parseModels(MODELS);

// ── Generate static flow HTML ─────────────────────────────────────────────────

note('Generating flow graph HTML…');
const flowLayoutKeys = buildFlowLayoutKeys(flowModel);
const html = await generateFlowGraph(flowModel, entityModel, 'static', {
    flowLayoutKeys,
});

const htmlPath = join(TMP, 'flow-drilldown.html');
await Bun.write(htmlPath, html);
note(`Wrote ${htmlPath} (${html.length} bytes)`);

// ── Playwright: screenshot top level + drill into sub-DFD ────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let ok = true;

try {
    await page.goto(`file://${htmlPath}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for the SVG renderer to signal readiness
    const svgReady = await page.waitForFunction(
        () => (window as unknown as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
        { timeout: 15_000 },
    ).then(() => true).catch(() => false);

    if (!svgReady) {
        fail('Timed out waiting for window.__IGNATIUS_FLOW_READY__');
    }

    await page.waitForTimeout(500);

    // Verify process nodes are present as SVG elements
    const nodeCount = await page.locator('[data-node-type="process"]').count();
    note(`Top level SVG process nodes: ${nodeCount}`);
    if (nodeCount < 1) {
        console.error(`FAIL: expected at least 1 process node, got ${nodeCount}`);
        ok = false;
    }

    // Screenshot top level
    const topScreenshotPath = join(TMP, 'flow-drilldown-top.png');
    await page.screenshot({ path: topScreenshotPath, fullPage: false });
    note(`Top-level screenshot saved to ${topScreenshotPath}`);
    const topSize = Bun.file(topScreenshotPath).size;
    if (topSize < 1000) {
        console.error(`FAIL: top screenshot is suspiciously small (${topSize} bytes)`);
        ok = false;
    } else {
        note(`Top screenshot size: ${topSize} bytes (non-trivial)`);
    }

    // ── Simulate drill-down by clicking a drillable process node in the SVG ──
    // FlowDiagramSvg marks drillable process nodes with data-has-sub-dfd="true".
    // Using this attribute is more robust than style*="pointer" which can match
    // other cursor-bearing elements or break if the style format changes.
    const drillableNodes = page.locator('[data-node-type="process"][data-has-sub-dfd="true"]');
    const drillableCount = await drillableNodes.count();
    const drillSuccess = drillableCount > 0;

    if (!drillSuccess) {
        console.error('FAIL: no drillable process node found (data-has-sub-dfd="true" not present)');
        ok = false;
    } else {
        note(`Found ${drillableCount} drillable process node(s); clicking first…`);

        // Two-phase wait: reset the flag first so we don't race on a stale `true`.
        await page.evaluate(() => {
            (window as unknown as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ = false;
        });

        await drillableNodes.first().click();
    }

    // Wait for the sub-DFD SVG to signal readiness (flag reset before click, so no stale read).
    await page.waitForFunction(
        () => (window as unknown as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
        { timeout: 10_000 },
    );
    await page.waitForTimeout(500);

    // Verify the sub-DFD is now rendered (count SVG nodes)
    const subNodeCount = await page.locator('[data-node-type]').count();
    note(`Sub-DFD SVG nodes: ${subNodeCount}`);

    // Screenshot the sub-DFD level
    const drillScreenshotPath = join(TMP, 'flow-drilldown.png');
    await page.screenshot({ path: drillScreenshotPath, fullPage: false });
    note(`Drill-down screenshot saved to ${drillScreenshotPath}`);
    const drillSize = Bun.file(drillScreenshotPath).size;
    if (drillSize < 1000) {
        console.error(`FAIL: drill-down screenshot is suspiciously small (${drillSize} bytes)`);
        ok = false;
    } else {
        note(`Drill-down screenshot size: ${drillSize} bytes (non-trivial)`);
    }

} catch (err) {
    fail(err instanceof Error ? err.message : String(err));
} finally {
    await browser.close();
}

if (!ok) {
    console.error('\nflow-drilldown visual check FAILED.');
    process.exit(1);
}
console.log('\nflow-drilldown visual check PASSED.');
console.log(`Top-level: ${join(TMP, 'flow-drilldown-top.png')}`);
console.log(`Sub-DFD:   ${join(TMP, 'flow-drilldown.png')}`);
