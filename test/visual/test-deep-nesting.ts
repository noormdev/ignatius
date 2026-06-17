/**
 * Visual verification: arbitrary DFD nesting depth.
 *
 * Serves test/fixtures/flows-leveling, navigates to Dictionary view (which
 * renders the DD sidebar process list with hierarchical dotted numbers), and
 * asserts that deep numbers 1.1.1.1 and 1.1.1.2 are visible in the DOM.
 *
 * Run: bun test/visual/test-deep-nesting.ts
 *
 * NOT run by `bun run test` — visual screenshot only. Requires:
 *   - Playwright chromium installed
 *   - test/fixtures/flows-leveling/ present with ignatius.yml + Party.md
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'deep-nesting');
mkdirSync(TMP, { recursive: true });

const PORT = 7420;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting server for test/fixtures/flows-leveling…');
const MODEL = join(ROOT, 'test/fixtures/flows-leveling');
const serverHandle = serveCommand(MODEL, { port: PORT });

async function waitForServer(url: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      // ECONNREFUSED while the server is still warming up — keep polling.
    }
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

// ── Navigate to Dictionary view ───────────────────────────────────────────────

note('Loading app in Dictionary view…');
await page.goto(`${BASE}/#view=dict`, { waitUntil: 'load' });

// Wait for the DD process list to populate — the auth diagram sidebar links
// contain the dotted numbers ("1.1 Authenticate", "1.1.1 Login", etc.).
// The selector `.dict-nav-link` covers both entity and process links; we check
// text content to confirm the flow process list rendered.
note('Waiting for DD sidebar process list…');
const navLinksAppeared = await page.waitForFunction(
  () => {
    const links = document.querySelectorAll('.dict-nav-link');
    // Need at least one link containing a dotted number (e.g. "1.1")
    for (const el of links) {
      if (/\d+\.\d+/.test(el.textContent ?? '')) return true;
    }
    return false;
  },
  { timeout: 30_000 },
).then(() => true).catch(() => false);

if (!navLinksAppeared) fail('DD process list with dotted numbers did not appear within 30 s');

// ── Collect the rendered dotted numbers ──────────────────────────────────────

note('Reading dotted numbers from DD sidebar…');
const renderedLinks = await page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll('.dict-nav-link')) {
    const text = (el.textContent ?? '').trim();
    if (text) out.push(text);
  }
  return out;
});

note(`  DD nav links: ${JSON.stringify(renderedLinks)}`);

// ── Screenshot ────────────────────────────────────────────────────────────────

const dictPath = await shot('01-dict-process-list.png');
note(`  Captured DD process list screenshot at: ${dictPath}`);

// ── Assertions ────────────────────────────────────────────────────────────────

note('Asserting deep dotted numbers are present…');

const allText = renderedLinks.join(' ');

if (!allText.includes('1.1.1.1')) {
  fail(`DOM does not contain "1.1.1.1" — rendered links: ${JSON.stringify(renderedLinks)}`);
}
note('PASS: "1.1.1.1" visible in DD process list');

if (!allText.includes('1.1.1.2')) {
  fail(`DOM does not contain "1.1.1.2" — rendered links: ${JSON.stringify(renderedLinks)}`);
}
note('PASS: "1.1.1.2" visible in DD process list');

if (!allText.includes('1.1.1')) {
  fail(`DOM does not contain "1.1.1" — rendered links: ${JSON.stringify(renderedLinks)}`);
}
note('PASS: "1.1.1" (Login) visible in DD process list');

if (!allText.includes('1.1')) {
  fail(`DOM does not contain "1.1" — rendered links: ${JSON.stringify(renderedLinks)}`);
}
note('PASS: "1.1" (Authenticate) visible in DD process list');

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
serverHandle.stop();

note(`\nAll assertions PASS.`);
note(`Screenshot: ${dictPath}`);
note('The DD process list shows deep dotted numbers 1.1, 1.1.1, 1.1.1.1, 1.1.1.2.');
process.exit(0);
