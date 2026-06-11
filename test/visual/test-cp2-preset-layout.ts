/**
 * Visual verification: CP2 — L1 preset-layout fast path.
 *
 * Proves:
 *  A. First load: ELK runs → layoutMode === 'elk' stamped in __IGNATIUS_PERF__.
 *  B. Second load (same model, same layoutKey): preset path taken →
 *     layoutMode === 'preset' stamped, ELK NOT run.
 *  C. Second-load time-to-layoutstop is strictly less than first-load.
 *  D. Compound parents (subtype clusters) render without displaced children.
 *  E. Screenshot dark + light: no visual regression after warm-cache load.
 *
 * Uses a small synthetic model (n≈50) so first-load ELK is seconds, not minutes.
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP  = join(ROOT, 'tmp', 'cp2-preset-layout');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Step 1: Generate a small synthetic model ──────────────────────────────────

const MODEL_N = 50;
const MODEL_DIR = join(ROOT, 'tmp', `synthetic-model-${MODEL_N}`);

note(`Generating synthetic model (n=${MODEL_N}) → ${MODEL_DIR}`);
const genResult = Bun.spawnSync(
  ['bun', 'scripts/gen-synthetic-model.ts', '--n', String(MODEL_N), '--out', MODEL_DIR],
  { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
);
if (genResult.exitCode !== 0) fail('Model generation failed');

// ── Step 2: Start the dev server ──────────────────────────────────────────────

const PORT = 7701;
const SERVER_URL = `http://localhost:${PORT}`;

note(`Starting ignatius serve ${MODEL_DIR} --port ${PORT}…`);
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', MODEL_DIR, '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(300);
  }
  return false;
}

const serverReady = await waitForServer(SERVER_URL, 20_000);
if (!serverReady) {
  proc.kill();
  fail('Server did not start within 20 seconds');
}
note('Server ready at ' + SERVER_URL);

// ── Step 3: Browser setup ─────────────────────────────────────────────────────

const browser  = await chromium.launch();
const context  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page     = await context.newPage();

type PerfMarker = {
  layoutStopAt: number;
  nodes: number;
  edges: number;
  layoutMode?: string;
};

async function waitForLayoutStop(timeoutMs = 120_000): Promise<PerfMarker> {
  const raw = await page.waitForFunction(
    () => {
      const w = window as { __IGNATIUS_PERF__?: PerfMarker };
      return w.__IGNATIUS_PERF__;
    },
    undefined,
    { timeout: timeoutMs },
  );
  return raw.jsonValue() as Promise<PerfMarker>;
}

// ── Step 4: First load (cold — no saved layout) ───────────────────────────────

note('First load (cold — clearing localStorage)…');
// Clear any stale position cache before the first load
await page.evaluate(() => {
  try { localStorage.removeItem('ignatius-layout-positions'); } catch {}
});
// Navigate must happen AFTER clear so the page reads empty storage
const firstNavStart = Date.now();
await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
const firstPerf = await waitForLayoutStop(120_000);
const firstLoadMs = Date.now() - firstNavStart;

note(`First load (elk): layoutMode=${firstPerf.layoutMode ?? 'MISSING'}, elapsed=${firstLoadMs}ms, nodes=${firstPerf.nodes}`);

// ── Assertion A: first load must run ELK ─────────────────────────────────────

if (firstPerf.layoutMode !== 'elk') {
  await browser.close();
  proc.kill();
  fail(`[A] Expected layoutMode='elk' on cold load, got '${firstPerf.layoutMode}'`);
}
note('[A] PASS: first load ran ELK');

// Screenshot: dark mode after first load
await page.waitForTimeout(300);
await page.screenshot({ path: join(TMP, 'first-load-dark.png'), fullPage: false });
note(`Saved first-load-dark.png`);

// ── Step 5: Second load (warm — layout should be cached) ──────────────────────

note('Second load (warm — layout should be cached)…');
// DO NOT clear localStorage — the positions saved by the first load should be there.
const secondNavStart = Date.now();
await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
const secondPerf = await waitForLayoutStop(30_000);
const secondLoadMs = Date.now() - secondNavStart;

note(`Second load (preset): layoutMode=${secondPerf.layoutMode ?? 'MISSING'}, elapsed=${secondLoadMs}ms`);

// ── Assertion B: second load must use preset ──────────────────────────────────

if (secondPerf.layoutMode !== 'preset') {
  await browser.close();
  proc.kill();
  fail(`[B] Expected layoutMode='preset' on warm load, got '${secondPerf.layoutMode}'`);
}
note('[B] PASS: second load used preset (ELK skipped)');

// ── Assertion C: second load must be strictly faster ─────────────────────────

if (secondLoadMs >= firstLoadMs * 0.5) {
  await browser.close();
  proc.kill();
  fail(`[C] Expected second load (${secondLoadMs}ms) < 50% of first load (${firstLoadMs}ms = ${Math.round(firstLoadMs * 0.5)}ms threshold)`);
}
note(`[C] PASS: second load (${secondLoadMs}ms) < 50% of first load (${firstLoadMs}ms)`);


// Screenshot: dark mode after second (warm) load
await page.waitForTimeout(300);
await page.screenshot({ path: join(TMP, 'second-load-dark.png'), fullPage: false });
note(`Saved second-load-dark.png`);

// ── Step 6: Light mode screenshot ─────────────────────────────────────────────

note('Switching to light mode…');
await page.evaluate(() => {
  const btn = document.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');
  if (btn) btn.click();
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(TMP, 'second-load-light.png'), fullPage: false });
note('Saved second-load-light.png');

// ── Step 7: Compound-parent / joiner assertion ────────────────────────────────

note('Checking compound parents and joiner nodes…');

const clusterCheck = await page.evaluate(() => {
  const w = window as { __IGNATIUS_CY__?: cytoscape.Core };
  const cy = w.__IGNATIUS_CY__;
  if (!cy) return { ok: false, reason: '__IGNATIUS_CY__ missing' };

  // Cluster compound parents: bounding box must encompass at least one child
  const parents = cy.nodes(':parent');
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i];
    const children = p.children();
    if (children.length === 0) continue;
    const pbb = p.boundingBox({});
    const cbb = children.boundingBox({});
    // Children bounding box must be contained within parent (with tolerance)
    if (cbb.x1 < pbb.x1 - 20 || cbb.y1 < pbb.y1 - 20 ||
        cbb.x2 > pbb.x2 + 20 || cbb.y2 > pbb.y2 + 20) {
      return { ok: false, reason: `Cluster '${p.id()}' children escaped bounding box` };
    }
  }

  // Joiner nodes: must not pile at origin (x≈0, y≈0)
  const joiners = cy.nodes('[?joiner]');
  let piledCount = 0;
  for (let i = 0; i < joiners.length; i++) {
    const pos = joiners[i].position();
    if (Math.abs(pos.x) < 5 && Math.abs(pos.y) < 5) piledCount++;
  }
  if (piledCount > 0) {
    return { ok: false, reason: `${piledCount} joiner node(s) piled at origin` };
  }

  return { ok: true, reason: '' };
});

if (!clusterCheck.ok) {
  await browser.close();
  proc.kill();
  fail(`[D] Compound-parent/joiner check failed: ${clusterCheck.reason}`);
}
note('[D] PASS: compound parents contain children; joiners not piled at origin');

// ── Done ──────────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();

note('');
note('┌─────────────────────────────────────────────────────┐');
note('│            CP2 L1 preset-layout results              │');
note('├─────────────────────────────────────────────────────┤');
note(`│  model:               synthetic n=${MODEL_N}                  │`);
note(`│  first-load (elk):    ${String(firstLoadMs + ' ms').padEnd(29)}│`);
note(`│  second-load (preset):${String(secondLoadMs + ' ms').padEnd(29)}│`);
note(`│  speedup:             ${(firstLoadMs / secondLoadMs).toFixed(1).padEnd(29)}x`);
note('└─────────────────────────────────────────────────────┘');
note('');
note('Screenshots saved to ' + TMP);
note('ALL ASSERTIONS PASSED');
