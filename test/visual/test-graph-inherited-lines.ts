/**
 * Visual verification: DG inferred-upstream (inherited) lines (key-inheritance-lineage CP-B).
 *
 * Selects Identity then ITIN in the graph and screenshots the dotted green
 * inferred-upstream lines drawn to each transitive 1:1 key-inheritance
 * connection. Also captures a deselect frame (no dotted lines).
 *
 * Uses models/key-inherited on port 7438. Screenshots land in tmp/graph-inherited-lines/.
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'graph-inherited-lines');
mkdirSync(TMP, { recursive: true });

const PORT = 7438;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

note('Starting ignatius serve models/key-inherited…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

if (!(await waitForServer(BASE, 12_000))) fail('Server did not start within 12 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`Screenshot: ${p}`);
}

// Emit a cy 'tap' on a node, then center the view on it + its inherited targets
// so the dotted lines are framed in the screenshot.
async function selectAndFrame(id: string): Promise<number> {
  return await page.evaluate((nodeId: string) => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return -1;
    const node = cy.$(`#${nodeId}`);
    if (node.empty()) return -1;
    cy.elements().unselect();
    node.select();
    node.emit('tap');
    const inherited = cy.edges('.inherited');
    // Fit the selected node + its inherited targets into view.
    const targets = node.union(inherited.connectedNodes());
    cy.fit(targets, 80);
    return inherited.length;
  }, id);
}

try {
  await page.goto(`${BASE}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForFunction(() => {
    const cy = window.__IGNATIUS_CY__;
    return !!cy && cy.nodes().length > 0;
  }, { timeout: 20_000 });
  await Bun.sleep(1000);

  // Tapping a node opens the rich entity modal (it covers the canvas). Hide the
  // modal with CSS so the dotted lines on the canvas are visible — hiding the
  // DOM node does NOT clear entity= (no hash change), so the edges persist.
  await page.addStyleTag({ content: '.modal-backdrop { display: none !important; }' });

  await shot('00-graph-initial.png');

  const identityCount = await selectAndFrame('Identity');
  await Bun.sleep(500);
  await shot('01-identity-selected.png');
  note(`Identity inherited dotted lines: ${identityCount}`);

  const itinCount = await selectAndFrame('ITIN');
  await Bun.sleep(500);
  await shot('02-itin-selected-transitive.png');
  note(`ITIN inherited dotted lines (transitive): ${itinCount}`);

  await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (cy) cy.emit('tap');
  });
  await Bun.sleep(300);
  await shot('03-deselected.png');
  const afterDeselect = await page.evaluate(() => window.__IGNATIUS_CY__?.edges('.inherited').length ?? -1);
  note(`Inherited lines after deselect: ${afterDeselect}`);

  note('\nVisual capture complete. Inspect tmp/graph-inherited-lines/.');
} finally {
  await page.close();
  await context.close();
  await browser.close();
  proc.kill();
}

process.exit(0);
