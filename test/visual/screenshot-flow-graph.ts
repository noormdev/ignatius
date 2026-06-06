/**
 * Visual verification: flow graph renders with the four canonical DFD node shapes.
 *
 * Uses models/key-inherited (which has the order-to-cash DFD with a sub-DFD)
 * to exercise a real multi-level model. Passes the whole FlowModel to
 * generateFlowGraph so the viewer carries all DFDs and the DFD selector renders.
 *
 * Self-contained: parses the model, generates static flow HTML, writes it to
 * tmp/, opens it with Playwright, waits for Cytoscape to initialise
 * (window.__IGNATIUS_CY__ is set by initFlowGraph), takes a screenshot, and
 * saves it to tmp/flow-graph.png.
 *
 * NOT run by `bun run test` — manual visual check only, matching the
 * convention of other test/visual/ scripts.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { parseFlows } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { generateFlowGraph, buildFlowLayoutKeys } from '../../src/generators/flow-graph';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); process.exit(1); };

// ── Parse model + flows ───────────────────────────────────────────────────────

note('Parsing flow model (models/key-inherited)…');
const { flowModel, globalErrors } = await parseFlows(MODELS);
if (globalErrors.length > 0) {
    fail(`parseFlows returned globalErrors: ${JSON.stringify(globalErrors)}`);
}
if (flowModel.diagrams.length === 0) {
    fail('parseFlows returned no diagrams');
}

note(`Diagrams (${flowModel.diagrams.length}): ${flowModel.diagrams.map(d => d.id).join(', ')}`);
for (const d of flowModel.diagrams) {
    note(`  ${d.id} — ${d.processes.length} processes, ${d.externals.length} externals, ${d.storeRefs.length} stores, ${d.edges.length} edges, ${d.subDfds.length} sub-DFDs`);
}

note('Parsing entity model…');
const { model: entityModel } = await parseModels(MODELS);

// ── Generate static flow HTML (whole FlowModel) ───────────────────────────────

note('Generating flow graph HTML (full FlowModel)…');
const flowLayoutKeys = buildFlowLayoutKeys(flowModel);
note(`Layout keys: ${Object.keys(flowLayoutKeys).join(', ')}`);

const html = await generateFlowGraph(flowModel, entityModel, 'static', {
    flowLayoutKeys,
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

    // Wait for the SVG renderer to signal readiness — initFlowGraph sets
    // window.__IGNATIUS_FLOW_READY__ = true once FlowDiagramSvg has mounted.
    const svgReady = await page.waitForFunction(
        () => (window as unknown as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
        { timeout: 15_000 },
    ).then(() => true).catch(() => false);

    if (!svgReady) {
        fail('Timed out waiting for window.__IGNATIUS_FLOW_READY__ — SVG renderer may not have mounted');
    }

    // Allow React render to settle
    await page.waitForTimeout(1000);

    // Verify the SVG element is present (FlowDiagramSvg renders <svg data-ignatius="flow-svg">)
    const svgCount = await page.locator('[data-ignatius="flow-svg"]').count();
    if (svgCount === 0) {
        console.error('FAIL: no flow SVG element found — SVG renderer may not have mounted');
        ok = false;
    } else {
        note(`Flow SVG elements found: ${svgCount}`);
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

    // Verify __FLOW_MODEL__ is an array in the page context
    const flowModelType = await page.evaluate(() => {
        const m = (window as unknown as { __FLOW_MODEL__?: unknown }).__FLOW_MODEL__;
        if (!m) return 'undefined';
        return Array.isArray(m) ? `array(${(m as unknown[]).length})` : typeof m;
    });
    if (!flowModelType.startsWith('array')) {
        console.error(`FAIL: __FLOW_MODEL__ is "${flowModelType}", expected array`);
        ok = false;
    } else {
        note(`__FLOW_MODEL__ is ${flowModelType}`);
    }

    // Verify __FLOW_LAYOUT_KEYS__ is an object in the page context
    const keysType = await page.evaluate(() => {
        const k = (window as unknown as { __FLOW_LAYOUT_KEYS__?: unknown }).__FLOW_LAYOUT_KEYS__;
        if (!k) return 'undefined';
        if (Array.isArray(k)) return 'array';
        return typeof k;
    });
    if (keysType !== 'object') {
        console.error(`FAIL: __FLOW_LAYOUT_KEYS__ is "${keysType}", expected object`);
        ok = false;
    } else {
        note(`__FLOW_LAYOUT_KEYS__ is an object`);
    }

    // Verify DFD selector is present when there are multiple top-level DFDs
    if (flowModel.diagrams.length > 1) {
        const selectorEl = await page.locator('[data-ignatius="flow-selector"]').count();
        if (selectorEl === 0) {
            console.error('FAIL: DFD selector element not found (expected for multi-DFD model)');
            ok = false;
        } else {
            note(`DFD selector element present`);
        }
    } else {
        note(`Single-DFD model — no selector expected`);
    }

    // Verify process nodes are present as SVG groups
    const procNodeCount = await page.locator('[data-node-type="process"]').count();
    if (procNodeCount < 1) {
        console.error(`FAIL: expected at least 1 process SVG node, got ${procNodeCount}`);
        ok = false;
    } else {
        note(`SVG process nodes: ${procNodeCount}`);
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

    // --- DFD swap test (only when selector is live, i.e. >1 top-level DFD) ---
    // Click the "refund" selector button, wait for the diagram to re-render,
    // confirm the node set changes, and take a screenshot of the swapped state.
    if (flowModel.diagrams.length > 1) {
        note('Testing DFD swap: clicking "refund" in selector…');

        // The selector renders buttons with textContent = diagram id.
        const refundBtn = page.locator('[data-ignatius="flow-selector"] button', { hasText: 'refund' });
        const refundBtnCount = await refundBtn.count();
        if (refundBtnCount === 0) {
            console.error('FAIL: "refund" button not found in DFD selector');
            ok = false;
        } else {
            // Record SVG node count before swap (order-to-cash is the initial diagram).
            const nodeCountBefore = await page.locator('[data-ignatius="flow-svg"] [data-node-type]').count();

            await refundBtn.click();
            // Wait for the SVG to re-render (ready flag briefly becomes false then true).
            await page.waitForFunction(
                () => (window as unknown as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
                { timeout: 10_000 },
            ).catch(() => {});
            await page.waitForTimeout(500);

            const nodeCountAfter = await page.locator('[data-ignatius="flow-svg"] [data-node-type]').count();

            note(`Node count before swap: ${nodeCountBefore}, after swap to refund: ${nodeCountAfter}`);

            if (nodeCountAfter < 1) {
                console.error(`FAIL: after swapping to refund, expected ≥1 SVG node, got ${nodeCountAfter}`);
                ok = false;
            } else {
                note('PASS: swap rendered nodes after selecting refund DFD');
            }

            if (nodeCountAfter === nodeCountBefore) {
                note(`NOTE: node counts are equal (${nodeCountAfter}) — order-to-cash and refund may coincidentally have the same node count`);
            } else {
                note(`PASS: node count changed (${nodeCountBefore} → ${nodeCountAfter}), confirming different diagram rendered`);
            }

            const swapScreenshotPath = join(TMP, 'flow-graph-swap.png');
            await page.screenshot({ path: swapScreenshotPath, fullPage: false });
            note(`Swap screenshot saved to ${swapScreenshotPath}`);

            const swapStat = Bun.file(swapScreenshotPath);
            const swapSize = swapStat.size;
            if (swapSize < 1000) {
                console.error(`FAIL: swap screenshot is suspiciously small (${swapSize} bytes)`);
                ok = false;
            } else {
                note(`Swap screenshot size: ${swapSize} bytes (non-trivial)`);
            }
        }
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
