/**
 * Visual verification: lineage highlight up the key-inheritance tree.
 *
 * On hover of a subtype/dependent entity, the highlight should travel UP the
 * identifying-edge chain to the root — signifying you can reach the root
 * because the key is inherited. The climb stops at a referential edge.
 *
 * Test chain (models/key-inherited):
 *   License --(identifying, subtype)--> Identity --(identifying)--> Party --(referential)--> PartyType
 *
 * Hovering License must KEEP License, Identity, Party lit (lineage), and must
 * FADE PartyType (reached only by a referential edge — key not inherited).
 *
 *   - tmp/lineage-before.png — no hover
 *   - tmp/lineage-after.png  — hovering License, lineage lit up to Party
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models', 'key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3295;

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

  await page.evaluate(() => window.__IGNATIUS_CY__?.fit(undefined, 50));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(TMP, 'lineage-before.png') });
  note('Saved tmp/lineage-before.png');

  // Hover License; report fade state of each node on the lineage chain.
  const state = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const license = cy.$id('License');
    if (license.empty()) return null;
    license.emit('mouseover');
    const faded = (id: string) => {
      const n = cy.$id(id);
      return n.empty() ? null : n.hasClass('faded');
    };
    return {
      License: faded('License'),
      Identity: faded('Identity'),
      Party: faded('Party'),
      PartyType: faded('PartyType'),
    };
  });

  await page.waitForTimeout(300);
  await page.screenshot({ path: join(TMP, 'lineage-after.png') });
  note(`Saved tmp/lineage-after.png — fade map: ${JSON.stringify(state)}`);

  if (!state) { fail('License node not found'); }
  else {
    // Lineage (identifying edges) must stay lit.
    if (state.License !== false) fail('License (hovered) should not be faded');
    if (state.Identity !== false) fail('Identity should be lit — identifying parent in lineage');
    if (state.Party !== false) fail('Party (root) should be lit — reached via identifying chain');
    // Referential edge must stop the climb.
    if (state.PartyType !== true) fail('PartyType should be faded — reached only by a referential edge');
    if (ok) note('Lineage lit License→Identity→Party; stopped at referential PartyType.');
  }

  const restored = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    cy.$id('License').emit('mouseout');
    return cy.elements().filter((e: CyEle) => e.hasClass('faded')).length;
  });
  if (restored !== 0) fail(`${restored} elements still faded after mouseout`);
  else note('all elements restored on mouseout');

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nLineage-highlight verification FAILED.'); process.exit(1); }
console.log('\nLineage-highlight verification passed.');
