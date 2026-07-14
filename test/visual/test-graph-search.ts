/**
 * Visual verification: Graph search (graph-flow-search CP2/CP5).
 *
 * Types "Party" into the Graph search bar and screenshots the result:
 * Party + PartyType highlighted (search-match), every other entity dimmed
 * (search-dim), and the "n of N" count readout visible. Captures BOTH theme
 * modes (CP5 visual-tightening pass: switch styling, count/focus treatment)
 * so the polish can be reviewed against dark AND light chrome.
 *
 * Run: bun test/visual/test-graph-search.ts
 *
 * NOT run by `bun run test` — visual screenshot only. Requires:
 *   - Playwright chromium installed
 *   - models/key-inherited present
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'graph-search');
mkdirSync(TMP, { recursive: true });

const PORT = 7457;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

note('Starting server for models/key-inherited…');
const MODEL = join(ROOT, 'models/key-inherited');
const serverHandle = serveCommand(MODEL, { port: PORT });

async function waitForServer(url: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise<void>(r => setTimeout(r, 250));
  }
  return false;
}

const serverReady = await waitForServer(BASE, 15_000);
if (!serverReady) fail('Server did not start within 15 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name: string): Promise<string> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`  Screenshot: ${p}`);
  return p;
}

note('Loading app on graph view…');
await page.goto(`${BASE}/#view=graph`, { waitUntil: 'load' });
await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
await page.waitForSelector('.viewer-search-bar--graph', { timeout: 10_000 });
await page.waitForTimeout(1500);

await shot('01-graph-no-search.png');
note('  Captured graph before any search.');

note('Typing "Party" into the search bar…');
await page.fill('.viewer-search-input', 'Party');
await page.waitForTimeout(500); // debounce + reapply

const readout = await page.locator('.viewer-search-count').textContent();
note(`  Count readout: "${readout}"`);

await shot('02-graph-search-active.png');
note('  Captured active search (dark): Party/PartyType highlighted, rest dimmed.');

note('Toggling to light theme…');
await page.locator('button[title="Switch to light mode"], button[title="Switch to dark mode"]').first().click();
await page.waitForTimeout(400); // re-theme settle
await page.locator('.viewer-search-input').focus(); // clicking the toggle stole focus — restore it so the focus ring shows
await page.waitForTimeout(200);

await shot('03-graph-search-active-light.png');
note('  Captured active search (light): same state, light theme chrome.');

await browser.close();
serverHandle.stop();

note('\nVisual check complete.');
note('Review 02-graph-search-active.png (dark) and 03-graph-search-active-light.png (light) — each should show:');
note('  - Party and PartyType with a gold border (search-match)');
note('  - Every other entity + non-connecting edges dimmed to ~0.2 opacity');
note('  - The "n of N" count readout in the search bar, and the "Include descriptions" switch');
process.exit(0);
