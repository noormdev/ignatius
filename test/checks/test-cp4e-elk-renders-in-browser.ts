/**
 * CP-4e integration guard: ELK actually runs in the BROWSER render.
 *
 * ELK layout was silently failing in the browser bundle (terminateWorker threw),
 * so FlowsView fell back to the banded positioner + hand-routed edges — for the
 * entire feature, undetected, because every unit test runs in Bun (where ELK's
 * worker terminates fine). This test closes that gap: it serves a model, loads
 * the Flows view in a real browser, and asserts ELK drove the render.
 *
 * Asserts:
 *  - no "ELK layout failed" warning in the browser console (no silent fallback);
 *  - the rendered DFD edge paths match the ELK-computed routes (ELK geometry is
 *    actually drawn, not orthogonalPath over banded positions).
 *
 * Skips (exit 0) when the React bundle isn't built — CI builds it before checks.
 */
import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'node:module';
import { serveCommand } from '../../src/server/server';
import { parseFlows } from '../../src/flows/flow-parse';
import { computeElkLayout } from '../../src/flow-view/elk-flow-layout';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

function findDiagram(ds: FlowDiagram[], id: string): FlowDiagram | null {
  for (const d of ds) { if (d.id === id) return d; const r = findDiagram(d.subDfds ?? [], id); if (r) return r; }
  return null;
}

// Expected ELK routes for memory-lifecycle (computed in Bun with a workerFactory).
const require = createRequire(import.meta.url);
const workerPath = require.resolve('elkjs/lib/elk-worker.min.js');
const { flowModel } = await parseFlows(MODEL);
const leaf = findDiagram(flowModel.diagrams, 'memory-lifecycle');
if (!leaf) { console.error('FAIL: memory-lifecycle diagram not found'); process.exit(1); }
const elk = await computeElkLayout(leaf, { workerFactory: () => new Worker(workerPath) });
const elkRouteKeys = new Set(
  Object.values(elk.edgeRoutes).map(pts => pts.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join('|')),
);

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); failures++; }
}

const PORT = 3294;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleMsgs: string[] = [];
page.on('console', m => consoleMsgs.push(m.text()));

try {
  await page.goto(`http://localhost:${PORT}/#view=flow&dfd=memory-lifecycle`, { waitUntil: 'load' });
  // Wait for the flow renderer to signal ready rather than a fixed sleep.
  await page.waitForFunction(() => window.__IGNATIUS_FLOW_READY__ === true, { timeout: 10000 }).catch(() => {});
  await new Promise<void>(r => setTimeout(r, 500));

  const elkFailed = consoleMsgs.some(m => /ELK layout failed/i.test(m));
  assert(!elkFailed, 'no "ELK layout failed" warning (ELK did not silently fall back)',
    elkFailed ? consoleMsgs.find(m => /ELK layout failed/i.test(m)) : undefined);

  // Compare rendered edge paths to the ELK routes.
  const renderedKeys: string[] = await page.evaluate(() => {
    const norm = (d: string): string => {
      const nums = d.match(/-?\d+(\.\d+)?/g) ?? [];
      const pts: string[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${Math.round(+nums[i]!)},${Math.round(+nums[i + 1]!)}`);
      return pts.join('|');
    };
    return Array.from(document.querySelectorAll('path[d]'))
      .map(p => norm(p.getAttribute('d') ?? ''))
      .filter(k => k.includes('|'));
  });
  const matches = renderedKeys.filter(k => elkRouteKeys.has(k)).length;
  // Each edge renders two <path> layers (visible + transparent hover), so expect
  // ≈ 2× the route count to match. Require at least one full set (>= route count).
  const routeCount = elkRouteKeys.size;
  assert(matches >= routeCount,
    `rendered edges match ELK routes (${matches} matches ≥ ${routeCount} routes)`,
    `only ${matches} rendered paths matched ELK route geometry — renderer is likely using orthogonalPath over banded positions`);
} finally {
  // Close the page before the browser so React unmounts cleanly (avoids the
  // "synchronous unmount while rendering" console warning), then stop the server.
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) { console.error(`\n${failures} failure(s).`); process.exit(1); }
console.log('\nCP-4e: ELK renders in the browser — all assertions passed.');
process.exit(0);
