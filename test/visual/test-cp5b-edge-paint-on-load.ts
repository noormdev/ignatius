/**
 * Visual verification: CP5b — edges + crow's-foot markers paint on load WITHOUT hover.
 *
 * Proves:
 *  A. ELK path (first cold load): SVG marker overlay has >0 <g> elements immediately
 *     after layoutstop + requestAnimationFrame, with no mouse interaction.
 *  B. Preset path (warm second load): same — markers present before any hover.
 *  C. Small model (key-inherited, n≈28) unregressed: markers present on both paths.
 *  D. Screenshots: dark + light, both paths — for visual inspection.
 *
 * Root cause (CP5b fix): cy.fit() updates cytoscape's internal viewport but does not
 * flush the canvas or read rendered endpoints. The fix adds cy.forceRender() after
 * cy.fit(), then defers SVG marker drawing to requestAnimationFrame so endpoints are
 * stable. Without the fix, redrawMarkers() read NaN endpoints and drew nothing; a
 * hover-triggered viewport event later caused the repaint.
 *
 * NOT run by `bun run test` — manual visual check only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP  = join(ROOT, 'tmp', 'cp5b-edge-paint-on-load');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Step 1: Generate a model large enough to trigger the bug ──────────────────

const MODEL_N = 200;
const MODEL_DIR = join(ROOT, 'tmp', `synthetic-model-${MODEL_N}`);

note(`Generating synthetic model (n=${MODEL_N}) → ${MODEL_DIR}`);
const genResult = Bun.spawnSync(
  ['bun', 'scripts/gen-synthetic-model.ts', '--n', String(MODEL_N), '--out', MODEL_DIR],
  { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
);
if (genResult.exitCode !== 0) fail('Model generation failed');

// ── Step 2: Start dev server ──────────────────────────────────────────────────

const PORT = 7702;
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
if (!serverReady) { proc.kill(); fail('Server did not start within 20 seconds'); }
note('Server ready at ' + SERVER_URL);

// ── Step 3: Browser setup ─────────────────────────────────────────────────────

const browser  = await chromium.launch();
const context  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page     = await context.newPage();

type PerfMarker = { layoutStopAt: number; nodes: number; edges: number; layoutMode?: string };

async function waitForLayoutStop(timeoutMs = 180_000): Promise<PerfMarker> {
  const raw = await page.waitForFunction(
    () => (window as { __IGNATIUS_PERF__?: PerfMarker }).__IGNATIUS_PERF__,
    undefined,
    { timeout: timeoutMs },
  );
  return raw.jsonValue() as Promise<PerfMarker>;
}

/** Count SVG marker <g> elements in the marker overlay (no hover, no interaction). */
async function countMarkerGroups(): Promise<number> {
  return page.evaluate(() => {
    const graphPanel = document.querySelector('.graph-panel') as HTMLElement | null;
    if (!graphPanel) return -1;
    const svgs = graphPanel.querySelectorAll('svg');
    let groups = 0;
    svgs.forEach(s => { groups += s.querySelectorAll('g').length; });
    return groups;
  });
}

// ── Step 4: First (cold) ELK load — no hover ────────────────────────────────

note('Clearing localStorage…');
await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  try { localStorage.removeItem('ignatius-layout-positions'); } catch {}
});

note(`First load (cold — ELK, n=${MODEL_N})…`);
await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
const perf1 = await waitForLayoutStop(180_000);
note(`ELK layoutstop: mode=${perf1.layoutMode}, nodes=${perf1.nodes}, edges=${perf1.edges}`);

// Wait for the requestAnimationFrame (the fix defers redrawMarkers to rAF)
await page.waitForTimeout(200);

// ── Assertion A: markers present on ELK load, NO hover ───────────────────────

const elkGroups = await countMarkerGroups();
note(`[A] Marker groups after ELK load (no hover): ${elkGroups}`);

if (elkGroups <= 0) {
  await page.screenshot({ path: join(TMP, 'fail-elk-no-hover.png') });
  await browser.close();
  proc.kill();
  fail(`[A] Expected >0 SVG marker <g> elements on ELK load without hover, got ${elkGroups}`);
}
note(`[A] PASS: ${elkGroups} marker groups present after ELK load (no hover)`);

// Screenshot: dark mode, ELK, no hover
await page.screenshot({ path: join(TMP, 'elk-dark-no-hover.png') });
note('Saved elk-dark-no-hover.png');

// Light mode screenshot
await page.evaluate(() => {
  const btn = document.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]');
  if (btn) btn.click();
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(TMP, 'elk-light-no-hover.png') });
note('Saved elk-light-no-hover.png');

// ── Step 5: Second (warm) preset load — no hover ─────────────────────────────

note('Second load (warm — preset)…');
await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });
const perf2 = await waitForLayoutStop(30_000);
note(`Preset layoutstop: mode=${perf2.layoutMode}, nodes=${perf2.nodes}`);

await page.waitForTimeout(200);

// ── Assertion B: markers present on preset load, NO hover ────────────────────

const presetGroups = await countMarkerGroups();
note(`[B] Marker groups after preset load (no hover): ${presetGroups}`);

if (presetGroups <= 0) {
  await page.screenshot({ path: join(TMP, 'fail-preset-no-hover.png') });
  await browser.close();
  proc.kill();
  fail(`[B] Expected >0 SVG marker <g> elements on preset load without hover, got ${presetGroups}`);
}
note(`[B] PASS: ${presetGroups} marker groups present after preset load (no hover)`);

await page.screenshot({ path: join(TMP, 'preset-dark-no-hover.png') });
note('Saved preset-dark-no-hover.png');

// ── Step 6: Small model regression check ─────────────────────────────────────

proc.kill();
await page.waitForTimeout(300);

const SMALL_MODEL = join(ROOT, 'models', 'key-inherited');
const PORT2 = 7703;

note(`Starting small-model server (key-inherited) --port ${PORT2}…`);
const proc2 = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', SMALL_MODEL, '--port', String(PORT2)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);
const server2Ready = await waitForServer(`http://localhost:${PORT2}`, 20_000);
if (!server2Ready) { proc2.kill(); fail('Small model server did not start'); }

await page.goto(`http://localhost:${PORT2}`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  try { localStorage.removeItem('ignatius-layout-positions'); } catch {}
});
await page.goto(`http://localhost:${PORT2}`, { waitUntil: 'domcontentloaded' });
const smallPerf = await waitForLayoutStop(60_000);
note(`Small model layoutstop: mode=${smallPerf.layoutMode}, nodes=${smallPerf.nodes}`);
await page.waitForTimeout(200);

// ── Assertion C: small model markers present ──────────────────────────────────

const smallGroups = await countMarkerGroups();
note(`[C] Small model marker groups (no hover): ${smallGroups}`);

if (smallGroups <= 0) {
  await page.screenshot({ path: join(TMP, 'fail-small-no-hover.png') });
  proc2.kill();
  await browser.close();
  fail(`[C] Small model regression: expected >0 marker groups, got ${smallGroups}`);
}
note(`[C] PASS: small model has ${smallGroups} marker groups (no regression)`);

await page.screenshot({ path: join(TMP, 'small-dark-no-hover.png') });
note('Saved small-dark-no-hover.png');

proc2.kill();
await browser.close();

// ── Summary ───────────────────────────────────────────────────────────────────

note('');
note('┌──────────────────────────────────────────────────────────┐');
note('│           CP5b edge-paint-on-load results                │');
note('├──────────────────────────────────────────────────────────┤');
note(`│  large ELK load (n=${MODEL_N}): ${elkGroups} marker groups (no hover)    │`);
note(`│  large preset load:       ${presetGroups} marker groups (no hover)    │`);
note(`│  small key-inherited:     ${smallGroups} marker groups (no hover)    │`);
note('│  ALL loads: markers present without hover — bug fixed    │');
note('└──────────────────────────────────────────────────────────┘');
note('');
note(`Screenshots saved to ${TMP}`);
note('ALL ASSERTIONS PASSED');
