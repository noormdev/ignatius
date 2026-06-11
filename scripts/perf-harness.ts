/**
 * Render performance measurement harness.
 *
 * Measures:
 *   parse-ms           — time for parseModels(dir) to complete (server-side parse)
 *   time-to-layoutstop — navigation start → ELK layoutstop fires (via window.__IGNATIUS_PERF__)
 *   time-to-interactive — navigation start → graph is usable (layoutstop + render settled)
 *   node-count          — cytoscape non-parent nodes
 *   edge-count          — cytoscape edges
 *   payload-bytes       — /api/model JSON payload size
 *
 * Usage:
 *   bun scripts/perf-harness.ts [--model <dir>] [--n <count>] [--port <port>] [--runs <k>]
 *
 * Default: generates a synthetic model (--n=300) into tmp/, runs the harness against it.
 * --model <dir>: skip generation, measure an existing model root.
 * --runs <k>: number of warm-up + measurement rounds (default 1; first run is cold).
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, '..');

function argValue(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  const next = process.argv[i + 1];
  return i >= 0 && next !== undefined ? next : def;
}

function argFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const N       = parseInt(argValue('--n', '300'), 10);
const PORT    = parseInt(argValue('--port', '7799'), 10);
const RUNS    = parseInt(argValue('--runs', '1'), 10);
const MODEL_ARG = argValue('--model', '');
// --mode organic|hierarchical — forces layout mode before measuring; default keeps
// whatever the browser has stored (usually 'organic' on a cold profile).
const MODE_ARG = argValue('--mode', '');

// ── Helpers ───────────────────────────────────────────────────────────────────

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForServer(url: string, timeout = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

// ── Step 1: Resolve / generate model ─────────────────────────────────────────

let modelDir: string;

if (MODEL_ARG) {
  modelDir = resolve(MODEL_ARG);
  note(`Using existing model: ${modelDir}`);
} else {
  modelDir = resolve(join(ROOT, `tmp/synthetic-model-${N}`));
  note(`Generating synthetic model (n=${N}) → ${modelDir}`);
  const genResult = Bun.spawnSync(
    ['bun', 'scripts/gen-synthetic-model.ts', '--n', String(N), '--out', modelDir],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
  );
  if (genResult.exitCode !== 0) fail('Model generation failed');
}

// ── Step 2: Parse timing (server-side, direct) ────────────────────────────────

note('Measuring parse time…');

const { parseModels } = await import('../src/model/parse');

let lastParseMs = 0;
for (let i = 0; i < Math.max(RUNS, 1); i++) {
  const t0 = performance.now();
  await parseModels(modelDir);
  lastParseMs = performance.now() - t0;
}
const parseMs = Math.round(lastParseMs);

// ── Step 3: Serve the model ───────────────────────────────────────────────────

note(`Starting ignatius serve ${modelDir} --port ${PORT}…`);

const serverProc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', modelDir, '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

const serverUrl = `http://localhost:${PORT}`;
const serverReady = await waitForServer(serverUrl, 25_000);
if (!serverReady) {
  serverProc.kill();
  fail('Server did not start in time');
}
note(`Server ready at ${serverUrl}`);

// ── Step 4: Payload size ──────────────────────────────────────────────────────

const apiResp = await fetch(`${serverUrl}/api/model`);
const apiBody = await apiResp.text();
const payloadBytes = Buffer.byteLength(apiBody, 'utf8');

// ── Step 5: Browser timing via Playwright ─────────────────────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page    = await context.newPage();

type PerfResult = {
  layoutStopMs: number;
  interactiveMs: number;
  nodes: number;
  edges: number;
};

async function measureRound(): Promise<PerfResult> {
  // Clear any cached layout positions so every run is a cold ELK run.
  // Optionally override the layout mode via --mode organic|hierarchical.
  await page.evaluate((modeArg: string) => {
    try { localStorage.removeItem('ignatius-layout-positions'); } catch {}
    if (modeArg === 'organic' || modeArg === 'hierarchical') {
      try { localStorage.setItem('ignatius-layout-mode', modeArg); } catch {}
    }
  }, MODE_ARG);

  const navStart = Date.now();
  await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });

  // Wait for __IGNATIUS_PERF__ to be stamped (layoutstop fired)
  // ELK on large graphs (300+ nodes) can take several minutes.
  // 10 minute timeout gives the baseline run enough room to complete.
  // arg (second param) must be undefined when the function takes no args;
  // options (third param) carries the timeout.
  // ELK on large graphs (300+ nodes) can take several minutes — 10 min timeout.
  const perfData = await page.waitForFunction(
    () => {
      const w = window as { __IGNATIUS_PERF__?: { layoutStopAt: number; nodes: number; edges: number } };
      return w.__IGNATIUS_PERF__;
    },
    undefined,
    { timeout: 600_000 },
  );

  const raw = await perfData.jsonValue() as { layoutStopAt: number; nodes: number; edges: number };
  const layoutStopMs = Math.round(Date.now() - navStart);

  // "Interactive" = layoutstop + 1 more rAF tick for React commit
  await page.waitForTimeout(200);
  const interactiveMs = Math.round(Date.now() - navStart);

  return {
    layoutStopMs,
    interactiveMs,
    nodes: raw.nodes,
    edges: raw.edges,
  };
}

// Optional warm-up run (discarded)
if (RUNS > 1) {
  note('Warm-up run (discarded)…');
  await measureRound();
}

note('Measuring browser render timing…');
const timing = await measureRound();

await browser.close();
serverProc.kill();

// ── Step 6: Print report ──────────────────────────────────────────────────────

const entityLabel = MODEL_ARG
  ? `${timing.nodes} (measured)`
  : String(N);

const modeLabel = MODE_ARG || 'stored/default';

const lines = [
  '',
  '┌─────────────────────────────────────────────────────┐',
  '│          ignatius render performance baseline        │',
  '├─────────────────────────────────────────────────────┤',
  `│  model:               ${modelDir.replace(ROOT + '/', '').padEnd(29)}│`,
  `│  layout mode:         ${modeLabel.padEnd(29)}│`,
  `│  entity count (n):    ${entityLabel.padEnd(29)}│`,
  `│  nodes (cy leaves):   ${String(timing.nodes).padEnd(29)}│`,
  `│  edges (cy):          ${String(timing.edges).padEnd(29)}│`,
  `│  payload:             ${(payloadBytes / 1024).toFixed(1).padEnd(24)} KiB │`,
  '├─────────────────────────────────────────────────────┤',
  `│  parse-ms:            ${String(parseMs + ' ms').padEnd(29)}│`,
  `│  time-to-layoutstop:  ${String(timing.layoutStopMs + ' ms').padEnd(29)}│`,
  `│  time-to-interactive: ${String(timing.interactiveMs + ' ms').padEnd(29)}│`,
  '└─────────────────────────────────────────────────────┘',
  '',
];

for (const l of lines) console.log(l);
