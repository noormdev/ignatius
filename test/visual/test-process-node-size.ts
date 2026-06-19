/**
 * Visual verification: DFD process node sizes to its label (#5).
 *
 * Navigates to a dense DFD in models/llm-memory-db-mssql whose processes carry
 * long names (e.g. "Attach Memory to Project", "Filter Memories by Tags"),
 * asserts every process's wrapped label text stays inside its rounded-rect box
 * (no overflow), and screenshots the diagram for human inspection.
 *
 * Run: bun test/visual/test-process-node-size.ts
 *
 * NOT run by `bun run test` — visual screenshot only. Requires:
 *   - Playwright chromium installed
 *   - models/llm-memory-db-mssql present
 *
 * If the browser cannot launch, this script reports that explicitly and exits 2
 * so the caller falls back to the unit test (test/checks/test-process-node-size.ts).
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'process-node-size');
mkdirSync(TMP, { recursive: true });

const PORT = 7421;
const BASE = `http://localhost:${PORT}`;
const DIAGRAM = 'memory-lifecycle';

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting server for models/llm-memory-db-mssql…');
const MODEL = join(ROOT, 'models/llm-memory-db-mssql');
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

// ── Launch browser (fall back to unit test if it cannot start) ────────────────

const browser = await chromium.launch().catch((e: unknown) => {
  console.error('COULD-NOT-VERIFY: chromium failed to launch —', e instanceof Error ? e.message : String(e));
  console.error('Fall back to the unit test: bun test/checks/test-process-node-size.ts');
  serverHandle.stop();
  process.exit(2);
});

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name: string): Promise<string> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`  Screenshot: ${p}`);
  return p;
}

// ── Navigate to the Flows view and select the dense diagram ───────────────────

note('Loading app…');
await page.goto(`${BASE}/#view=flow`, { waitUntil: 'load' });
const flowReady = await page.waitForFunction(
  () => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__,
  undefined,
  { timeout: 40_000 },
).then(() => true).catch(() => false);
if (!flowReady) fail('Flow view did not signal ready in 40 s');
await page.waitForTimeout(800);

note(`Navigating to ${DIAGRAM} diagram…`);
await page.evaluate((id) => {
  const handle = (window as { __IGNATIUS_FLOW_HANDLE__?: { selectDiagramById?: (id: string) => void } }).__IGNATIUS_FLOW_HANDLE__;
  if (handle?.selectDiagramById) handle.selectDiagramById(id);
  else location.hash = `#view=flow&dfd=${id}`;
}, DIAGRAM);
await page.waitForTimeout(1500);

const diagramShot = await shot('01-diagram.png');

// ── Assert every process's wrapped text fits inside its rect ──────────────────

note('Measuring process boxes vs their label text…');
const report = await page.evaluate(() => {
  const svg = document.querySelector('[data-ignatius="flow-svg"]');
  if (!svg) return { ok: false, reason: 'no flow-svg', procs: [] as Array<{ id: string; label: string; fits: boolean; overflow: number }> };
  const procs: Array<{ id: string; label: string; fits: boolean; overflow: number }> = [];
  for (const g of svg.querySelectorAll('[data-node-type="process"]')) {
    const id = g.getAttribute('data-node-id') ?? '?';
    const rect = g.querySelector('rect');
    if (!rect) continue;
    const rectBox = (rect as SVGGraphicsElement).getBBox();
    const texts = g.querySelectorAll('text');
    let label = '';
    let maxOverflow = 0;
    let fits = true;
    for (const t of texts) {
      const tb = (t as SVGGraphicsElement).getBBox();
      const content = t.textContent ?? '';
      // skip the number badge (single short token, far left) and affordance glyphs (ⓘ / ⤵)
      if (content === 'ⓘ' || content === '⤵') continue;
      // accumulate the label lines (exclude the dotted number badge which sits inside the badge circle)
      // heuristic: the badge text is numeric/dotted; label lines contain letters.
      if (/[A-Za-z]/.test(content)) label += (label ? ' ' : '') + content;
      // overflow if a text line extends past the rect's left/right/top/bottom edges
      const overLeft = rectBox.x - tb.x;
      const overRight = (tb.x + tb.width) - (rectBox.x + rectBox.width);
      const overTop = rectBox.y - tb.y;
      const overBottom = (tb.y + tb.height) - (rectBox.y + rectBox.height);
      const over = Math.max(overLeft, overRight, overTop, overBottom);
      if (over > 1.0 && /[A-Za-z]/.test(content)) {
        fits = false;
        maxOverflow = Math.max(maxOverflow, over);
      }
    }
    procs.push({ id, label, fits, overflow: Math.round(maxOverflow * 10) / 10 });
  }
  return { ok: true, reason: '', procs };
});

if (!report.ok) fail(`Could not measure process boxes: ${report.reason}`);

note(`Found ${report.procs.length} process node(s):`);
let anyOverflow = false;
let longestLabel = '';
for (const p of report.procs) {
  if (p.label.length > longestLabel.length) longestLabel = p.label;
  const mark = p.fits ? 'inside' : `OVERFLOW by ${p.overflow}px`;
  note(`  ${p.fits ? 'OK ' : 'BAD'} "${p.label}" — ${mark}`);
  if (!p.fits) anyOverflow = true;
}

await shot('02-diagram-final.png');

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
serverHandle.stop();

note('');
note(`Longest process label seen: "${longestLabel}" (${longestLabel.length} chars)`);
note(`Screenshot: ${diagramShot}`);
note('Review the screenshot — every process label must sit fully inside its rounded box.');

if (anyOverflow) {
  fail('At least one process label overflows its box — #5 not satisfied.');
}
note('PASS: every process label fits inside its box (#5).');
process.exit(0);
