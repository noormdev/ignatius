/**
 * Visual verification: DG inferred-upstream (inherited) lines + 3-tier focus
 * opacity (key-inheritance-lineage CP-B + the 3-tier opacity refinement).
 *
 * Selects Identity then ITIN in the graph and screenshots the dotted green
 * inferred-upstream lines drawn to each transitive 1:1 key-inheritance
 * connection. Also captures a deselect frame (no dotted lines).
 *
 * 3-tier opacity refinement: when an entity is focused the graph splits into
 *   • Direct    — focused node + real neighbors + connecting edges → opacity 1.0
 *   • Inherited — inherited ray targets (`.inherited-dim`) + the dotted ray
 *                 edges (`edge.inherited`) → opacity 0.5
 *   • Unrelated — everything else (`.faded`) → opacity 0.2
 * This script reads `ele.style('opacity')` + applied classes straight off
 * `window.__IGNATIUS_CY__` and asserts the three tiers are visually distinct.
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

interface TierReadout {
  direct: { id: string; opacity: number; classes: string } | null;
  inherited: { id: string; opacity: number; classes: string } | null;
  inheritedEdge: { id: string; opacity: number; classes: string } | null;
  unrelated: { id: string; opacity: number; classes: string } | null;
}

// Read one representative element per tier off the live cy, reporting its
// resolved opacity and applied classes. Run AFTER a node is selected.
async function readTiers(selectedId: string): Promise<TierReadout> {
  return await page.evaluate((selId: string) => {
    const cy = window.__IGNATIUS_CY__;
    const empty: TierReadout = { direct: null, inherited: null, inheritedEdge: null, unrelated: null };
    if (!cy) return empty;
    const node = cy.$(`#${selId}`);
    if (node.empty()) return empty;

    type Ele = {
      id(): string;
      style(p: string): string;
      classes(): string[];
      hasClass(c: string): boolean;
    };
    const read = (e: Ele) => ({
      id: e.id(),
      opacity: Number(e.style('opacity')),
      classes: e.classes().join(' '),
    });

    // Direct: a real graph neighbor of the selected node (NOT an inherited
    // ray target). Closed neighborhood minus the dotted-ray targets.
    const inheritedEdges = cy.edges('.inherited');
    const inheritedTargets = inheritedEdges.connectedNodes();
    const directNeighbors = node
      .closedNeighborhood()
      .nodes()
      .difference(inheritedTargets)
      .difference(node)
      .filter((n: { isParent(): boolean }) => !n.isParent());
    const direct = directNeighbors.nonempty() ? read(directNeighbors[0]) : read(node[0]);

    // Inherited: an inherited ray TARGET node carrying `.inherited-dim`.
    const dimNode = cy.nodes('.inherited-dim');
    const inherited = dimNode.nonempty() ? read(dimNode[0]) : null;

    // Inherited edge: a dotted ray edge.
    const inheritedEdge = inheritedEdges.nonempty() ? read(inheritedEdges[0]) : null;

    // Unrelated: a faded node not in any of the above.
    const fadedNodes = cy.nodes('.faded');
    const unrelated = fadedNodes.nonempty() ? read(fadedNodes[0]) : null;

    return { direct, inherited, inheritedEdge, unrelated } satisfies TierReadout;
  }, selectedId);
}

let tierFailures = 0;
function tierAssert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    note(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    tierFailures++;
  }
}

function approx(a: number, b: number, eps = 0.06): boolean {
  return Math.abs(a - b) <= eps;
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

  // ── 3-tier opacity readout for Identity ─────────────────────────────────
  const identityTiers = await readTiers('Identity');
  note('\nIdentity 3-tier opacity readout:');
  note(`  direct        : ${JSON.stringify(identityTiers.direct)}`);
  note(`  inherited node: ${JSON.stringify(identityTiers.inherited)}`);
  note(`  inherited edge: ${JSON.stringify(identityTiers.inheritedEdge)}`);
  note(`  unrelated     : ${JSON.stringify(identityTiers.unrelated)}`);

  tierAssert(
    identityTiers.direct !== null && approx(identityTiers.direct.opacity, 1.0),
    'DIRECT tier ≈ 1.0 (full, solid)',
    identityTiers.direct ? `opacity=${identityTiers.direct.opacity} on ${identityTiers.direct.id}` : 'no direct element',
  );
  tierAssert(
    identityTiers.inherited !== null && approx(identityTiers.inherited.opacity, 0.5),
    'INHERITED node tier ≈ 0.5 (.inherited-dim)',
    identityTiers.inherited ? `opacity=${identityTiers.inherited.opacity} on ${identityTiers.inherited.id} [${identityTiers.inherited.classes}]` : 'no inherited-dim node',
  );
  tierAssert(
    identityTiers.inheritedEdge !== null && approx(identityTiers.inheritedEdge.opacity, 0.5),
    'INHERITED ray edge ≈ 0.5 (edge.inherited)',
    identityTiers.inheritedEdge ? `opacity=${identityTiers.inheritedEdge.opacity} on ${identityTiers.inheritedEdge.id}` : 'no inherited edge',
  );
  tierAssert(
    identityTiers.unrelated !== null && approx(identityTiers.unrelated.opacity, 0.2),
    'UNRELATED tier ≈ 0.2 (.faded)',
    identityTiers.unrelated ? `opacity=${identityTiers.unrelated.opacity} on ${identityTiers.unrelated.id} [${identityTiers.unrelated.classes}]` : 'no faded node',
  );
  tierAssert(
    identityTiers.direct !== null && identityTiers.inherited !== null && identityTiers.unrelated !== null &&
      identityTiers.direct.opacity > identityTiers.inherited.opacity &&
      identityTiers.inherited.opacity > identityTiers.unrelated.opacity,
    'STRICT ordering: direct > inherited > unrelated',
    identityTiers.direct && identityTiers.inherited && identityTiers.unrelated
      ? `${identityTiers.direct.opacity} > ${identityTiers.inherited.opacity} > ${identityTiers.unrelated.opacity}`
      : 'missing tier',
  );

  const itinCount = await selectAndFrame('ITIN');
  await Bun.sleep(500);
  await shot('02-itin-selected-transitive.png');
  note(`ITIN inherited dotted lines (transitive): ${itinCount}`);

  // ── 3-tier opacity readout for ITIN (transitive set still at 0.5) ────────
  const itinTiers = await readTiers('ITIN');
  note('\nITIN 3-tier opacity readout:');
  note(`  direct        : ${JSON.stringify(itinTiers.direct)}`);
  note(`  inherited node: ${JSON.stringify(itinTiers.inherited)}`);
  note(`  inherited edge: ${JSON.stringify(itinTiers.inheritedEdge)}`);
  note(`  unrelated     : ${JSON.stringify(itinTiers.unrelated)}`);
  tierAssert(
    itinTiers.inherited !== null && approx(itinTiers.inherited.opacity, 0.5),
    'ITIN transitive inherited node ≈ 0.5',
    itinTiers.inherited ? `opacity=${itinTiers.inherited.opacity} on ${itinTiers.inherited.id}` : 'no inherited-dim node',
  );
  tierAssert(
    itinTiers.unrelated !== null && approx(itinTiers.unrelated.opacity, 0.2),
    'ITIN unrelated ≈ 0.2',
    itinTiers.unrelated ? `opacity=${itinTiers.unrelated.opacity} on ${itinTiers.unrelated.id}` : 'no faded node',
  );

  await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (cy) cy.emit('tap');
  });
  await Bun.sleep(300);
  await shot('03-deselected.png');
  const afterDeselect = await page.evaluate(() => window.__IGNATIUS_CY__?.edges('.inherited').length ?? -1);
  note(`Inherited lines after deselect: ${afterDeselect}`);

  // ── Deselect must clear EVERY tier class — no tier survives a deselect ────
  const tierLeak = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return { faded: -1, dim: -1, hoverFocus: -1, minOpacity: -1 };
    let minOpacity = 1;
    cy.elements().forEach((e: { style(p: string): string }) => {
      minOpacity = Math.min(minOpacity, Number(e.style('opacity')));
    });
    return {
      faded: cy.elements('.faded').length,
      dim: cy.elements('.inherited-dim').length,
      hoverFocus: cy.nodes('.hover-focus').length,
      minOpacity,
    };
  });
  note(`After deselect — faded:${tierLeak.faded} inherited-dim:${tierLeak.dim} hover-focus:${tierLeak.hoverFocus} minOpacity:${tierLeak.minOpacity}`);
  tierAssert(tierLeak.faded === 0, 'no `.faded` class survives deselect');
  tierAssert(tierLeak.dim === 0, 'no `.inherited-dim` class survives deselect');
  tierAssert(tierLeak.hoverFocus === 0, 'no `.hover-focus` class survives deselect');
  tierAssert(approx(tierLeak.minOpacity, 1.0), 'all elements back to full opacity after deselect', `min=${tierLeak.minOpacity}`);

  note('\nVisual capture complete. Inspect tmp/graph-inherited-lines/.');
  if (tierFailures > 0) {
    console.error(`\n${tierFailures} 3-tier opacity assertion(s) FAILED.`);
  } else {
    note('\nAll 3-tier opacity assertions passed.');
  }
} finally {
  await page.close();
  await context.close();
  await browser.close();
  proc.kill();
}

if (tierFailures > 0) process.exit(1);

process.exit(0);
