/**
 * Visual verification: Flow search (graph-flow-search CP3).
 *
 * Types "Validate" into the Flows search bar and screenshots the result: the
 * results dropdown open (Validate Customer, grouped under Create Sales Order)
 * while the currently-rendered diagram's own nodes — none of which match —
 * render dimmed (searchTokens folded into FlowDiagramSvg's opacity rules).
 *
 * Run: bun test/visual/test-flow-search.ts
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
const TMP = join(ROOT, 'tmp', 'flow-search');
mkdirSync(TMP, { recursive: true });

const PORT = 7458;
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

note('Loading app on flow view…');
await page.goto(`${BASE}/#view=flow`, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
await page.waitForSelector('.viewer-search-bar--flow', { timeout: 10_000 });
await page.waitForTimeout(1000);

await shot('01-flow-no-search.png');
note('  Captured flow view before any search.');

note('Typing "Validate" into the flow search bar…');
await page.fill('.viewer-search-input', 'Validate');
await page.waitForSelector('.viewer-search-result-row[data-token="proc:Validate-Customer"]', { timeout: 5000 });
await page.waitForTimeout(300); // let the opacity transition settle

await shot('02-flow-search-active.png');
note('  Captured active search: dropdown open, current diagram nodes dimmed.');

await browser.close();
serverHandle.stop();

note('\nVisual check complete.');
note('Review 02-flow-search-active.png — it should show:');
note('  - The results dropdown open, listing "Validate Customer" (1.1.1) under "Create Sales Order"');
note('  - Every node in the currently-rendered diagram dimmed to ~0.3 opacity (none match "Validate")');
process.exit(0);
