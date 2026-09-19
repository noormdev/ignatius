/**
 * Visual verification: hover-fade of non-connected elements.
 *
 * On node hover, non-neighborhood nodes + edges should drop to 0.3 opacity.
 * Captures before/after screenshots and asserts the .faded class application
 * deterministically via the window.__IGNATIUS_CY__ debug seam.
 *
 *   - tmp/hover-fade-before.png — no hover, nothing faded
 *   - tmp/hover-fade-after.png  — hovering a node, non-neighborhood elements faded
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { HOVER_INTENT_MS } from '../../src/app/logic/motion';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models', 'key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3294;

interface CyEle {
  id(): string;
  hasClass(c: string): boolean;
}

const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForTimeout(2500);

  const target = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return null;
    const node = cy.nodes().filter((n: CyEle & { connectedEdges(): { length: number } }) =>
      n.connectedEdges().length > 0)[0];
    if (!node) return null;
    cy.fit(undefined, 50);
    return { id: node.id() };
  });

  if (!target) { fail('no connected node found'); process.exit(1); }
  note(`Target node: ${target.id}`);

  await page.waitForTimeout(300);
  await page.screenshot({ path: join(TMP, 'hover-fade-before.png') });
  note('Saved tmp/hover-fade-before.png');

  await page.evaluate((id: string) => {
    window.__IGNATIUS_CY__!.$id(id).emit('mouseover');
  }, target.id);
  // Hover focus applies only once the pointer rests on the target (motion.ts).
  await page.waitForTimeout(HOVER_INTENT_MS + 100);

  const counts = await page.evaluate((id: string) => {
    const cy = window.__IGNATIUS_CY__!;
    const node = cy.$id(id);
    const all = cy.elements();
    const faded = all.filter((e: CyEle) => e.hasClass('faded'));
    const keep = node.closedNeighborhood();
    return { total: all.length, faded: faded.length, keep: keep.length };
  }, target.id);

  await page.screenshot({ path: join(TMP, 'hover-fade-after.png') });
  note(`Saved tmp/hover-fade-after.png (faded=${counts.faded}/${counts.total}, keep=${counts.keep})`);

  if (counts.faded === 0) fail('no elements were faded on hover');
  if (counts.faded + counts.keep !== counts.total) {
    fail(`faded(${counts.faded}) + keep(${counts.keep}) != total(${counts.total})`);
  }

  await page.evaluate((id: string) => {
    window.__IGNATIUS_CY__!.$id(id).emit('mouseout');
  }, target.id);
  // Leaving clears the fade only after the same settle delay.
  await page.waitForTimeout(HOVER_INTENT_MS + 100);

  const restored = await page.evaluate(() => {
    return window.__IGNATIUS_CY__!.elements().filter((e: CyEle) => e.hasClass('faded')).length;
  });

  if (restored !== 0) fail(`${restored} elements still faded after mouseout`);
  else note('all elements restored on mouseout');

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nHover-fade verification FAILED.'); process.exit(1); }
console.log('\nHover-fade verification passed.');
