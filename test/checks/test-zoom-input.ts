/**
 * CP4 (viewer-ux-polish) pinch + Cmd/Ctrl zoom → canvas — integration check.
 *
 * Closes the reviewer-flagged gap: the regression-critical native non-passive
 * `wheel` listeners (GraphView + FlowDiagramSvg) and the keyboard zoom path
 * (shortcuts.ts + useKeyboardShortcuts) were verified only by throwaway probes.
 * This is the committed, CI-runnable proof of the CP4 contract:
 *
 *   "Trackpad pinch (ctrl/meta + wheel) and Cmd/Ctrl +/-/0 zoom the active
 *    canvas and NEVER the browser page, on both the Data Graph (Cytoscape) and
 *    the Data Flows view (custom SVG)."
 *
 * Synthetic DOM events are UNTRUSTED — a real browser will not actually
 * page-zoom on them — so the page never visibly zooms regardless of our code.
 * We therefore prove the contract with two observations together:
 *
 *   1. The zoom CHANGED  → our canvas zoom path ran (Cytoscape's wheel handler
 *      / the React onWheel math / the keyboard zoom callback).
 *   2. The event was defaultPrevented  → OUR listener called preventDefault,
 *      which is exactly what blocks the browser page-zoom default on a real
 *      (trusted) event.
 *
 * `dispatchEvent` returns false when any listener called preventDefault on a
 * cancelable event — that is our reliable "defaultPrevented" signal for the
 * synthetic wheel events. For keydown we read `e.defaultPrevented` off the same
 * event object after a synchronous dispatch (the window keydown handler runs
 * inline and mutates the event in place).
 *
 * A negative control proves we do NOT over-eagerly hijack plain scroll: a plain
 * wheel (no ctrl/meta) over the canvas is NOT defaultPrevented by our listener.
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds the
 * bundle before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

/**
 * Read the live Cytoscape zoom level in the page. The ambient `cytoscape.Core`
 * type on `window.__IGNATIUS_CY__` does not surface `zoom()` inside a
 * page.evaluate browser-context callback (a known type-resolution quirk), and
 * casting is disallowed — so we narrow through a runtime guard on `unknown`,
 * which both type-checks cleanly and asserts the seam is actually present.
 */
function readCyZoom(page: import('playwright').Page): Promise<number | null> {
  return page.evaluate(() => {
    const cy: unknown = window.__IGNATIUS_CY__;
    if (cy === null || typeof cy !== 'object' || !('zoom' in cy)) return null;
    const zoom: unknown = cy.zoom;
    if (typeof zoom !== 'function') return null;
    const value: unknown = zoom.call(cy);
    return typeof value === 'number' ? value : null;
  });
}

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3300;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // ── Graph view: wait for Cytoscape to mount and expose window.__IGNATIUS_CY__ ──
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForFunction(() => window.__IGNATIUS_CY__ !== undefined && window.__IGNATIUS_CY__ !== null, { timeout: 20_000 });
  // Let the initial fit layout settle so cy.zoom() is stable before we poke it.
  await new Promise<void>(r => setTimeout(r, 1200));

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Graph pinch (ctrl + wheel): canvas zooms AND page-zoom default blocked
  // ───────────────────────────────────────────────────────────────────────────
  const graphZoomBeforePinch = await readCyZoom(page);
  const graphPinch = await page.evaluate(() => {
    const container = document.querySelector('.graph-panel');
    if (!(container instanceof HTMLElement)) {
      return { ok: false as const, reason: 'no .graph-panel container' };
    }
    const rect = container.getBoundingClientRect();
    // ctrl+wheel with negative deltaY = pinch-zoom-in over the canvas center.
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    // dispatchEvent returns false iff a listener called preventDefault on this
    // cancelable event — i.e. our native non-passive listener fired.
    const notPrevented = container.dispatchEvent(ev);
    return { ok: true as const, defaultPrevented: !notPrevented };
  });
  const graphZoomAfterPinch = await readCyZoom(page);

  assert(graphPinch.ok, 'graph pinch: cy + container present', graphPinch.ok ? undefined : graphPinch.reason);
  if (graphPinch.ok) {
    assert(
      graphZoomBeforePinch !== null && graphZoomAfterPinch !== null && graphZoomAfterPinch !== graphZoomBeforePinch,
      'graph pinch (ctrl+wheel): cy.zoom() CHANGED — canvas zoomed',
      `before=${graphZoomBeforePinch} after=${graphZoomAfterPinch}`,
    );
    assert(
      graphPinch.defaultPrevented,
      'graph pinch (ctrl+wheel): event defaultPrevented — page-zoom blocked',
      `defaultPrevented=${graphPinch.defaultPrevented}`,
    );
  }

  // NOTE on the graph negative control: there is intentionally NO "plain wheel
  // not defaultPrevented" assertion on the GRAPH. Cytoscape attaches its own
  // non-passive wheel listener and calls preventDefault on a PLAIN wheel to
  // perform its built-in scroll-to-zoom (verified: a plain wheel on .graph-panel
  // both zooms cy AND reports defaultPrevented, with our ctrl/meta-gated CP4
  // listener never firing). A dispatchEvent-based negative control there would
  // measure Cytoscape's behavior, not ours, so it cannot isolate a CP4
  // over-eager-preventDefault regression. The faithful negative control lives on
  // the FLOW SVG below, where the page-zoom block is purely CP4's concern
  // (React's onWheel is passive and does not preventDefault).

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Graph keyboard: Cmd/Ctrl + = / - / 0 → canvas zoom; keydown defaultPrevented
  // ───────────────────────────────────────────────────────────────────────────
  const isMac = process.platform === 'darwin';

  // Helper: dispatch a keydown carrying the platform zoom modifier, then read
  // defaultPrevented off the SAME event object after the window keydown handler
  // (useKeyboardShortcuts) has run — a synchronous bubble listener mutates the
  // event in place, so ev.defaultPrevented reflects our handler's preventDefault.
  // Returns the cy.zoom() before/after and whether the default was prevented.
  async function zoomKey(key: string): Promise<{ before: number | null; after: number | null; defaultPrevented: boolean }> {
    // Ensure focus is on body so the editable guard does not apply.
    await page.evaluate(() => document.body.focus());
    const before = await readCyZoom(page);
    const defaultPrevented = await page.evaluate((args: { key: string; meta: boolean; ctrl: boolean }) => {
      const ev = new KeyboardEvent('keydown', {
        key: args.key,
        bubbles: true,
        cancelable: true,
        metaKey: args.meta,
        ctrlKey: args.ctrl,
      });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, { key, meta: isMac, ctrl: !isMac });
    // cy.zoom() may animate; poll briefly for it to settle to a changed value.
    await new Promise<void>(r => setTimeout(r, 250));
    const after = await readCyZoom(page);
    return { before, after, defaultPrevented };
  }

  // Both readings must be present and strictly ordered for an increase/decrease.
  const increased = (b: number | null, a: number | null): boolean => b !== null && a !== null && a > b;
  const decreased = (b: number | null, a: number | null): boolean => b !== null && a !== null && a < b;

  const zin = await zoomKey('=');
  assert(
    increased(zin.before, zin.after),
    'keyboard Cmd/Ctrl + "=" : cy.zoom() INCREASED (zoom in)',
    `before=${zin.before} after=${zin.after}`,
  );
  assert(
    zin.defaultPrevented,
    'keyboard Cmd/Ctrl + "=" : keydown defaultPrevented — page-zoom blocked',
    `defaultPrevented=${zin.defaultPrevented}`,
  );

  const zout = await zoomKey('-');
  assert(
    decreased(zout.before, zout.after),
    'keyboard Cmd/Ctrl + "-" : cy.zoom() DECREASED (zoom out)',
    `before=${zout.before} after=${zout.after}`,
  );
  assert(
    zout.defaultPrevented,
    'keyboard Cmd/Ctrl + "-" : keydown defaultPrevented — page-zoom blocked',
    `defaultPrevented=${zout.defaultPrevented}`,
  );

  // Pre-reset, nudge the zoom away from fit so reset has somewhere to return to.
  await zoomKey('=');
  const beforeReset = await readCyZoom(page);
  const zreset = await zoomKey('0');
  // Reset re-fits the graph. The fit percent on this model is the baseline the
  // graph first loaded at — assert reset MOVED the zoom (toward fit) and the
  // keydown was prevented. We compare against the immediately-prior zoom value.
  assert(
    zreset.defaultPrevented,
    'keyboard Cmd/Ctrl + "0" : keydown defaultPrevented — page-zoom blocked',
    `defaultPrevented=${zreset.defaultPrevented}`,
  );
  assert(
    beforeReset !== null && zreset.after !== null && zreset.after !== beforeReset,
    'keyboard Cmd/Ctrl + "0" : cy.zoom() returned toward fit (changed from the zoomed-in value)',
    `beforeReset=${beforeReset} afterReset=${zreset.after}`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Flow pinch (ctrl + wheel): SVG inner-<g> scale CHANGED; default blocked
  // ───────────────────────────────────────────────────────────────────────────
  await page.goto(`http://localhost:${PORT}/#view=flow`, { waitUntil: 'load' });
  await page.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 20_000 });
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, { timeout: 20_000 });
  await new Promise<void>(r => setTimeout(r, 600));

  // Read the inner <g> scale(...) factor from its transform attribute.
  const readFlowScale = () => page.evaluate(() => {
    const g = document.querySelector('[data-ignatius="flow-svg"] > g[transform]');
    if (!(g instanceof SVGElement)) return null;
    const t = g.getAttribute('transform') ?? '';
    const m = t.match(/scale\(([-0-9.eE]+)\)/);
    const captured = m?.[1];
    return captured === undefined ? null : parseFloat(captured);
  });

  const flowScaleBefore = await readFlowScale();
  assert(flowScaleBefore !== null, 'flow pinch: inner <g> scale transform readable', `scale=${flowScaleBefore}`);

  const flowPinch = await page.evaluate(() => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]');
    if (!(svg instanceof SVGSVGElement)) return { ok: false as const };
    const rect = svg.getBoundingClientRect();
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    const notPrevented = svg.dispatchEvent(ev);
    return { ok: true as const, defaultPrevented: !notPrevented };
  });
  assert(flowPinch.ok, 'flow pinch: flow-svg present');

  // The React onWheel updates state; allow a tick for the re-render.
  await new Promise<void>(r => setTimeout(r, 300));
  const flowScaleAfter = await readFlowScale();

  if (flowPinch.ok) {
    assert(
      flowScaleBefore !== null && flowScaleAfter !== null && flowScaleAfter !== flowScaleBefore,
      'flow pinch (ctrl+wheel): inner <g> scale CHANGED — canvas zoomed',
      `before=${flowScaleBefore} after=${flowScaleAfter}`,
    );
    assert(
      flowPinch.defaultPrevented,
      'flow pinch (ctrl+wheel): event defaultPrevented — page-zoom blocked',
      `defaultPrevented=${flowPinch.defaultPrevented}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4 (flow). Negative control: plain wheel over the SVG is NOT defaultPrevented
  //           by our listener (the React onWheel is passive and does not prevent).
  // ───────────────────────────────────────────────────────────────────────────
  const flowPlainWheel = await page.evaluate(() => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]');
    if (!(svg instanceof SVGSVGElement)) return { ok: false as const };
    const rect = svg.getBoundingClientRect();
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      deltaY: -120,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    const notPrevented = svg.dispatchEvent(ev);
    return { ok: true as const, defaultPrevented: !notPrevented };
  });
  assert(flowPlainWheel.ok, 'flow plain wheel: flow-svg present');
  if (flowPlainWheel.ok) {
    assert(
      !flowPlainWheel.defaultPrevented,
      'flow plain wheel (no ctrl): NOT defaultPrevented by our listener (plain scroll not hijacked)',
      `defaultPrevented=${flowPlainWheel.defaultPrevented}`,
    );
  }

  // Report the actual zoom numbers observed for the orchestrator's log.
  console.log('\nObserved zoom values:');
  if (graphPinch.ok) console.log(`  graph pinch:    cy.zoom ${graphZoomBeforePinch} → ${graphZoomAfterPinch}`);
  console.log(`  graph key + : cy.zoom ${zin.before} → ${zin.after}`);
  console.log(`  graph key - : cy.zoom ${zout.before} → ${zout.after}`);
  console.log(`  graph key 0 : cy.zoom ${beforeReset} → ${zreset.after}`);
  console.log(`  flow pinch:     scale ${flowScaleBefore} → ${flowScaleAfter}`);

} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP4 zoom-input: all assertions passed.');
process.exit(0);
