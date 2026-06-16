/**
 * CP2+CP4 visual assertion: edge-label truncated-preview strategy.
 *
 * Proves C5 + C13 from docs/spec/dfd-overhaul.md (updated for CP4):
 *
 *  C5  — on the dense diagrams `memory-lifecycle` and `tag-administration`,
 *         db: column-list edges (long labels) now render a single truncated
 *         preview chip ending with '…'. The chip text is shorter than the full
 *         column list but the full data is reachable via hover/data-contract.
 *
 *  C13 — the full data contract (column list) is reachable in the DOM for each
 *         truncated-preview edge: the data-contract attribute carries the label
 *         text so the contract is disclosed on hover (styled HTML tooltip).
 *         The native SVG <title> has been removed; the styled tooltip is the
 *         sole full-disclosure mechanism. data-contract is the programmatic
 *         anchor.
 *
 * Run: bun test/visual/test-cp2-dfd-edge-labels.ts
 *
 * NOT run by `bun run test` — visual/DOM assertion only. Requires:
 *   - Playwright chromium installed
 *   - models/llm-memory-db-mssql present (the proving model)
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp2-dfd-edge-labels');
mkdirSync(TMP, { recursive: true });

const PORT = 7402;
const BASE = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

function assert(cond: boolean, label: string): void {
  if (cond) { note(`  PASS  ${label}`); } else { fail(label); }
}

// ── Start server ──────────────────────────────────────────────────────────────

note('Starting ignatius serve models/llm-memory-db-mssql…');
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', 'models/llm-memory-db-mssql', '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(250);
  }
  return false;
}

const serverReady = await waitForServer(BASE, 15_000);
if (!serverReady) fail('Server did not start within 15 seconds');
note(`Server ready at ${BASE}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name: string): Promise<void> {
  const p = join(TMP, name);
  await page.screenshot({ path: p, fullPage: false });
  note(`  Screenshot: ${p}`);
}

// ── Navigate to the Flows view ────────────────────────────────────────────────

async function waitForFlowReady(): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow view did not signal ready in 15 s');
}

note('Loading app…');
await page.goto(`${BASE}/#view=flow`);
await waitForFlowReady();
await page.waitForTimeout(800); // settle animations

async function selectDiagram(diagramId: string): Promise<void> {
  // Navigate to the diagram via hash deep-link and wait for the SVG to render.
  await page.evaluate((id: string) => {
    const f = (window as { __IGNATIUS_FLOW_GEN__?: number }).__IGNATIUS_FLOW_GEN__;
    // Call FlowsView's selectDiagramById if available, else use hash navigation.
    const handle = (window as { __IGNATIUS_FLOW_HANDLE__?: { selectDiagramById?: (id: string) => void } }).__IGNATIUS_FLOW_HANDLE__;
    if (handle?.selectDiagramById) {
      handle.selectDiagramById(id);
    } else {
      location.hash = `#view=flow&dfd=${id}`;
    }
    void f;
  }, diagramId);
  await page.waitForTimeout(1200);
}

// ── Per-diagram assertion ─────────────────────────────────────────────────────

interface EdgeReport {
  id: string;
  /** True when data-contract-type="hidden" — i.e. the edge has a long label with a truncated preview chip. */
  isHidden: boolean;
  contractText: string;
  /** Whether the edge group still carries the data-contract attribute (regression guard). */
  hasDataContract: boolean;
  /** Whether a native SVG <title> is present — should be ABSENT after CP2. */
  hasSvgTitle: boolean;
  /** C5 structural check: number of [data-ignatius="flow-chip"] elements
   *  that are descendants of the edge group.
   *  After CP4: hidden edges now produce exactly 1 truncated preview chip. */
  associatedChipCount: number;
  /** Text content of the first chip element inside the edge group, or '' if none. */
  firstChipText: string;
}

/**
 * Introspect the SVG to verify CP2+CP4 constraints:
 *
 *  C5  — for every edge group with data-contract-type="hidden", exactly ONE
 *         [data-ignatius="flow-chip"] element exists inside its subtree (the
 *         truncated preview chip added by CP4). Its text ends with '…' and is
 *         shorter than the full data-contract text (not the full column list).
 *
 *  C13 — the data-contract attribute on each gated (hidden) edge group carries
 *         non-empty contract text (the styled HTML tooltip reads from this).
 *         The native SVG <title> must NOT be present (it has been superseded).
 *
 * Returns a list of edge reports for inspection.
 */
async function collectEdgeReports(): Promise<EdgeReport[]> {
  return page.evaluate((): EdgeReport[] => {
    const svg = document.querySelector('[data-ignatius="flow-svg"]');
    if (!svg) return [];

    const reports: EdgeReport[] = [];
    for (const g of svg.querySelectorAll('[data-contract]')) {
      const contractText = g.getAttribute('data-contract') ?? '';
      const contractType = g.getAttribute('data-contract-type') ?? '';

      // C5 structural check: chip count inside this edge group.
      const chipEls = g.querySelectorAll('[data-ignatius="flow-chip"]');
      const associatedChipCount = chipEls.length;
      const firstChipText = chipEls.length > 0 ? (chipEls[0].textContent ?? '') : '';

      // C13 (updated): no native <title>; data-contract is the programmatic anchor.
      const hasSvgTitle = g.querySelector('title') !== null;

      reports.push({
        id: contractText.slice(0, 20),
        isHidden: contractType === 'hidden',
        contractText,
        hasDataContract: contractText.length > 0,
        hasSvgTitle,
        associatedChipCount,
        firstChipText,
      });
    }
    return reports;
  });
}

// ── Diagram checks ────────────────────────────────────────────────────────────

const DIAGRAMS = ['memory-lifecycle', 'tag-administration'];

for (const diagramId of DIAGRAMS) {
  note(`\n--- Diagram: ${diagramId} ---`);

  await selectDiagram(diagramId);
  await shot(`${diagramId}-before.png`);

  const reports = await collectEdgeReports();

  note(`  Found ${reports.length} labelled edges in DOM.`);

  const hiddenReports = reports.filter(r => r.isHidden);
  const inlineReports = reports.filter(r => !r.isHidden);

  note(`  Truncated-preview (hidden) edges: ${hiddenReports.length}`);
  note(`  Inline (short payload) edges: ${inlineReports.length}`);

  // C5 (updated for CP4): every hidden edge must contain exactly ONE chip element
  // showing a truncated preview ending with '…'. The chip text must be shorter
  // than the full data-contract text (it is the truncated first ~22 chars, not
  // the full column list).
  let hiddenWithoutChip = 0;
  let hiddenWithBadChip = 0;
  for (const r of hiddenReports) {
    if (r.associatedChipCount !== 1) {
      hiddenWithoutChip++;
      note(`  ERROR truncated edge "${r.contractText.slice(0, 60)}" has ${r.associatedChipCount} chip(s) — expected exactly 1`);
    } else if (!r.firstChipText.endsWith('…')) {
      hiddenWithBadChip++;
      note(`  ERROR truncated edge chip text "${r.firstChipText}" does not end with '…'`);
    } else if (r.firstChipText === r.contractText) {
      hiddenWithBadChip++;
      note(`  ERROR truncated edge chip text equals full contract — not actually truncated: "${r.firstChipText}"`);
    } else {
      note(`  PASS truncated edge: chip="${r.firstChipText}" vs full="${r.contractText.slice(0, 60)}…"`);
    }
  }
  assert(
    hiddenWithoutChip === 0,
    `C5 ${diagramId}: ${hiddenReports.length} truncated-preview edges, each must have exactly 1 chip — ${hiddenWithoutChip} did not`,
  );
  assert(
    hiddenWithBadChip === 0,
    `C5 ${diagramId}: truncated preview chip must end with '…' and differ from the full contract — ${hiddenWithBadChip} did not`,
  );

  // C13 (updated): for gated edges, data-contract carries the full label text.
  // Native SVG <title> must NOT be present — it has been removed in CP2;
  // the styled HTML tooltip is the sole hover disclosure mechanism.
  let hiddenWithoutContract = 0;
  let hiddenWithSvgTitle = 0;
  for (const r of hiddenReports) {
    if (!r.hasDataContract) hiddenWithoutContract++;
    if (r.hasSvgTitle) hiddenWithSvgTitle++;
  }
  assert(
    hiddenWithoutContract === 0,
    `C13 ${diagramId}: ${hiddenReports.length} gated edges, all must have data-contract text — ${hiddenWithoutContract} missing`,
  );
  assert(
    hiddenWithSvgTitle === 0,
    `C13 ${diagramId}: native SVG <title> must be absent (superseded by styled tooltip) — ${hiddenWithSvgTitle} edges still have it`,
  );

  // Sanity: there must be some truncated-preview edges on these dense diagrams.
  assert(hiddenReports.length > 0, `C5/C13 ${diagramId}: no truncated-preview edges found — test is vacuous`);

  await shot(`${diagramId}-after.png`);
  note(`  PASS ${diagramId}: C5 and C13 satisfied.`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await browser.close();
proc.kill();
note('\nAll CP2+CP4 visual assertions passed (C5 + C13).');
process.exit(0);
