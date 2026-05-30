/**
 * CP-5 visual verification: graph surface findings.
 *
 * Captures three screenshots for orchestrator review:
 *   - tmp/cp5-graph-live.png  — live server, graph viewer with warning badges
 *   - tmp/cp5-graph-static.png — static graph.html, same view
 *   - tmp/cp5-graph-modal.png — detail modal open on an entity with issues
 *
 * The real models/ dir has 18 entity errors, 0 global errors.
 * Expected: no global banner, warning badge circles on ~14 entity nodes.
 *
 * NOT run by `bun run test` (visual/ scripts are for manual orchestrator review).
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3291;

// ---------------------------------------------------------------------------
// Live mode screenshots
// ---------------------------------------------------------------------------

const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/`);
  console.log('Waiting for graph to render...');
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(2500);

  // -- Screenshot 1: live graph with warning badges --
  await page.screenshot({ path: join(TMP, 'cp5-graph-live.png'), fullPage: false });
  console.log('Saved: tmp/cp5-graph-live.png');

  // -- Screenshot 3: modal on an entity with issues --
  // Navigate to an entity with known issues via hash (entity.naming_not_pascal_case ones)
  // The real models/ has 6 naming issues — pick one we know exists.
  // Try clicking in the center-left area of the graph which likely has a node.
  const graphPanel = page.locator('.graph-panel');
  const bbox = await graphPanel.boundingBox();
  if (bbox) {
    // Try a few positions to find a node
    const positions = [
      [0.3, 0.35],
      [0.5, 0.4],
      [0.4, 0.5],
      [0.6, 0.3],
    ];
    let modalOpened = false;
    for (const [xFrac, yFrac] of positions) {
      await page.mouse.click(bbox.x + bbox.width * xFrac, bbox.y + bbox.height * yFrac);
      await page.waitForTimeout(400);
      const modalVisible = await page.locator('.modal').isVisible().catch(() => false);
      if (modalVisible) {
        modalOpened = true;
        break;
      }
    }

    if (modalOpened) {
      await page.screenshot({ path: join(TMP, 'cp5-graph-modal.png'), fullPage: false });
      console.log('Saved: tmp/cp5-graph-modal.png');
    } else {
      console.log('WARNING: Could not open entity modal — no screenshot for cp5-graph-modal.png');
    }
  }
} finally {
  await browser.close();
}

handle.stop(true);

// ---------------------------------------------------------------------------
// Static mode screenshot
// ---------------------------------------------------------------------------

const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
if (!bundleExists) {
  console.log('SKIP: static graph screenshot — dist/static/index.js not built');
  console.log('Run: bun run build:bundle first');
} else {
  const OUT = join(TMP, 'graph-cp5-visual.html');
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), 'graph', MODELS, '-o', OUT], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), 30_000);
  await proc.exited;
  clearTimeout(timer);

  // Serve via HTTP — file:// blocks ELK WASM in Chromium
  const STATIC_PORT2 = 3292;
  const staticHtml = await Bun.file(OUT).text();
  const staticSrv = Bun.serve({
    port: STATIC_PORT2,
    fetch() {
      return new Response(staticHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  });

  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await page2.goto(`http://localhost:${STATIC_PORT2}/`);
    console.log('Waiting for static graph to render...');
    await page2.waitForSelector('.graph-panel canvas', { timeout: 20_000 }).catch(() => null);
    await page2.waitForTimeout(3000);

    await page2.screenshot({ path: join(TMP, 'cp5-graph-static.png'), fullPage: false });
    console.log('Saved: tmp/cp5-graph-static.png');
  } finally {
    await browser2.close();
    staticSrv.stop(true);
  }
}

console.log('Done.');
