// Runs are sized before any hover, yet hovering a table swaps each line into it to the reverse predicate on
// the same run; on key-inherited, where many reverse predicates are longer, every one must still fit.

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');

if (!existsSync(join(ROOT, 'dist/static/index.js'))) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 55_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-tree-predicate-hover.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

const PORT = 3334;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30_000);

type RunLabel = { id: string; label: string; spill: number };

let failures = 0;
try {
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForTimeout(1500);

  const mode = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
  if (mode !== 'tree') throw new Error(`a first visit should open in Tree, got ${mode}`);

  // Entities with a labelled line coming in: hovering one of them shows its reverse predicates.
  const children = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return [];
    return [...new Set(cy.edges('.tree-edge').filter(e => e.data('predicateRev') !== undefined).map(e => e.target().id()))];
  });
  if (children.length === 0) throw new Error('no labelled tree lines to hover');

  let checked = 0;
  for (const id of children) {
    await page.evaluate((nid: string) => { window.__IGNATIUS_CY__?.$id(nid).emit('mouseover'); }, id);
    await page.waitForTimeout(HOVER_INTENT_MS + 60);
    // How far each reverse label, background pad included, runs past either end of its run.
    const labels: RunLabel[] = await page.evaluate((nid: string) => {
      const cy = window.__IGNATIUS_CY__;
      if (!cy) return [];
      const out: RunLabel[] = [];
      cy.$id(nid).connectedEdges('.tree-edge').forEach((e) => {
        if (e.data('predicateMode') !== 'rev') return;
        const atSource = e.hasClass('tree-label-source');
        const bends = e.segmentPoints() ?? [];
        const corner = atSource ? bends[0] : bends[bends.length - 1];
        const end = atSource ? e.sourceEndpoint() : e.targetEndpoint();
        if (corner === undefined) return;
        const box = e.boundingBox({
          includeNodes: false, includeEdges: false, includeLabels: true, includeMainLabels: false,
          includeSourceLabels: atSource, includeTargetLabels: !atSource, includeOverlays: false,
        });
        const spill = Math.max(Math.min(corner.x, end.x) - box.x1, box.x2 - Math.max(corner.x, end.x));
        out.push({ id: e.id(), label: String(e.data('edgeLabel')), spill: Math.round(spill) });
      });
      return out;
    }, id);
    for (const l of labels) {
      checked++;
      if (l.spill > 0) {
        console.error(`  FAIL  ${l.id}: "${l.label}" runs ${l.spill}px past its run`);
        failures++;
      }
    }
    await page.evaluate((nid: string) => { window.__IGNATIUS_CY__?.$id(nid).emit('mouseout'); }, id);
    await page.waitForTimeout(HOVER_INTENT_MS + 60);
  }
  if (checked === 0) throw new Error('no reverse label landed on a run');
  console.log(`  checked ${checked} reverse labels on runs`);
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  clearTimeout(watchdog);
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\nFAIL: test-tree-predicate-hover (${failures})`);
  process.exit(1);
}
console.log('PASS: test-tree-predicate-hover');
