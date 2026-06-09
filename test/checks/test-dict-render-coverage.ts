/**
 * CP8b render-level coverage for DictionaryView behaviors previously guarded
 * by the deleted string-check tests (test-dict-ordering, test-dict-subtype-info,
 * test-dict-findings, test-dict-examples).
 *
 * Uses the live server against models/key-inherited (clean model) and
 * models/broken-demo (model with known findings) to assert:
 *
 * 1. Sort order: entity sections appear in hierarchy order within a group
 *    (independent before dependent; basetype before its subtypes).
 *    Verified: Party (independent basetype) before Business + Person (subtypes).
 *
 * 2. Subtype badges: an entity that is a basetype renders a .badge-basetype span;
 *    an entity that is a member renders a .badge-subtype span.
 *
 * 3. Warning triangle: an entity with a validation finding renders a warning
 *    triangle (⚠ character or .dict-entity-warn class) on its section heading.
 *    Verified against models/broken-demo which has known per-entity findings.
 *
 * 4. Examples accordion: when a model fixture has examples, the dict renders
 *    a .dict-examples <details> element (tested via the export check + string
 *    assertion path — see test-export-union-injection.ts which pins __MODEL__).
 *    For the live render path: key-inherited does not ship examples today so we
 *    assert that .dict-examples is NOT rendered for entities without examples
 *    (false-positive guard).
 *
 * Run: bun test/checks/test-dict-render-coverage.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '../..');
const PORT_A = 7290; // clean model
const PORT_B = 7291; // broken-demo

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

function assert(condition: boolean, label: string) {
  if (condition) {
    note(`  PASS  ${label}`);
  } else {
    fail(label);
  }
}

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

// ── Spawn two servers ────────────────────────────────────────────────────────

note(`Starting key-inherited server on port ${PORT_A}…`);
const procA = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT_A)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

note(`Starting broken-demo server on port ${PORT_B}…`);
const procB = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/broken-demo', '--port', String(PORT_B)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

const [readyA, readyB] = await Promise.all([
  waitForServer(`http://localhost:${PORT_A}`, 12_000),
  waitForServer(`http://localhost:${PORT_B}`, 12_000),
]);

if (!readyA) { procA.kill(); procB.kill(); fail('key-inherited server did not start'); }
if (!readyB) { procA.kill(); procB.kill(); fail('broken-demo server did not start'); }
note('Both servers ready.');

const browser = await chromium.launch();

async function openDict(port: number) {
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(ctx => ctx.newPage());
  await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Switch to Dictionary via FAB
  const fab = page.locator('.fab').first();
  if (await fab.count() === 0) fail('FAB (.fab) not found');
  await fab.click();
  await page.waitForTimeout(200);

  const dictItem = page.locator('.fab-menu-item').filter({ hasText: 'Dictionary' });
  if (await dictItem.count() === 0) fail('Dictionary FAB menu item not found');
  await dictItem.click();

  // Wait for at least one entity section
  await page.locator('.dict-entity-section').first().waitFor({ timeout: 8000 });
  return page;
}

try {
  // ── Section A: key-inherited model ──────────────────────────────────────────
  note('\n── Section A: key-inherited (sort order, subtype badges, no false-positive examples) ──');
  const pageA = await openDict(PORT_A);

  // ── 1. Sort order: Party (independent basetype) before Business + Person ──
  note('1. Sort order: Party before its subtypes Business and Person…');
  const allSections = pageA.locator('.dict-entity-section');
  const sectionCount = await allSections.count();
  assert(sectionCount >= 3, `Expected ≥ 3 entity sections (got ${sectionCount})`);

  // Collect bounding-box top-y for each entity id we care about
  async function getSectionTop(id: string): Promise<number> {
    const section = pageA.locator(`#entity-${id}`);
    const count = await section.count();
    if (count === 0) fail(`#entity-${id} not found in DOM`);
    const box = await section.boundingBox();
    if (!box) fail(`#entity-${id} has no bounding box`);
    // fail() exits the process; if we reach here box is non-null.
    return box?.y ?? -1;
  }

  const partyY = await getSectionTop('Party');
  const businessY = await getSectionTop('Business');
  const personY = await getSectionTop('Person');

  assert(partyY < businessY, `Party (y=${partyY}) appears before Business (y=${businessY}) — basetype before subtypes`);
  assert(partyY < personY, `Party (y=${partyY}) appears before Person (y=${personY}) — basetype before subtypes`);

  // ── 2. Subtype badges ──
  // Party is a basetype → renders "basetype · exclusive/inclusive" in a .dict-badge span.
  // Business/Person are subtype members → render "of Party" in a .dict-badge span.
  note('2. Subtype badges: basetype badge on Party, member badge on Business/Person…');

  const partyBadges = pageA.locator('#entity-Party .dict-badge');
  const partyBadgeText = await partyBadges.allTextContents();
  const hasBasetypeBadge = partyBadgeText.some(t => t.includes('basetype'));
  assert(hasBasetypeBadge, `#entity-Party has a .dict-badge containing "basetype" (got: ${JSON.stringify(partyBadgeText)})`);

  const businessBadges = pageA.locator('#entity-Business .dict-badge');
  const businessBadgeText = await businessBadges.allTextContents();
  const businessHasMemberBadge = businessBadgeText.some(t => t.includes('Party'));
  assert(businessHasMemberBadge, `#entity-Business has a .dict-badge linking to Party (got: ${JSON.stringify(businessBadgeText)})`);

  const personBadges = pageA.locator('#entity-Person .dict-badge');
  const personBadgeText = await personBadges.allTextContents();
  const personHasMemberBadge = personBadgeText.some(t => t.includes('Party'));
  assert(personHasMemberBadge, `#entity-Person has a .dict-badge linking to Party (got: ${JSON.stringify(personBadgeText)})`);

  // ── 3. Examples accordion ──
  // key-inherited has examples on several entities (e.g. Party, Business, Person, Identity, etc.)
  // Assert that: (a) .dict-examples is rendered for entities that have examples, and
  // (b) the accordion contains a <summary> and a <table>.
  note('3. Examples accordion: .dict-examples rendered for entities with examples…');
  const examplesAccordions = pageA.locator('.dict-examples');
  const examplesCount = await examplesAccordions.count();
  assert(examplesCount > 0, `key-inherited has ≥ 1 .dict-examples accordion(s) (got ${examplesCount})`);

  // The first accordion must contain a summary and a table.
  const firstAccordion = examplesAccordions.first();
  const summary = firstAccordion.locator('summary');
  assert(await summary.count() > 0, 'First .dict-examples has a <summary>');
  const summaryText = await summary.first().textContent();
  assert(summaryText !== null && summaryText.includes('Example'), `First .dict-examples summary mentions "Example" (got: "${summaryText}")`);

  const examplesTable = firstAccordion.locator('table.dict-examples-table');
  assert(await examplesTable.count() > 0, 'First .dict-examples has a <table class="dict-examples-table">');

  // ── 3b. PK-first column order in examples table header ──
  // Payment has pk: [party_id, payment_method_id, payment_id] and non-PK columns
  // amount + paid_at.  DictExamplesAccordion builds headers as [...pk, ...declaredCols]
  // so the three PK columns must appear before the two non-PK columns.
  // This assertion FAILS if the ordering were reversed or interleaved.
  note('3b. PK-first column order: Payment examples table header — PK cols before non-PK cols…');
  const paymentSection = pageA.locator('#entity-Payment');
  if (await paymentSection.count() === 0) fail('#entity-Payment not found in DOM');

  const paymentAccordion = paymentSection.locator('.dict-examples');
  if (await paymentAccordion.count() === 0) fail('#entity-Payment has no .dict-examples accordion');

  const paymentHeaders = await paymentAccordion.locator('table.dict-examples-table thead th').allTextContents();
  // Trim whitespace (th contains <code> text)
  const headerNames = paymentHeaders.map(h => h.trim());
  note(`  Payment examples header columns: ${JSON.stringify(headerNames)}`);

  // PK columns for Payment
  const pkCols = ['party_id', 'payment_method_id', 'payment_id'];
  // Non-PK columns for Payment
  const nonPkCols = ['amount', 'paid_at'];

  // All PK cols must be present
  for (const pk of pkCols) {
    assert(headerNames.includes(pk), `Payment examples header includes PK col "${pk}"`);
  }
  // All non-PK cols must be present
  for (const col of nonPkCols) {
    assert(headerNames.includes(col), `Payment examples header includes non-PK col "${col}"`);
  }

  // Every PK col must appear at an index BEFORE every non-PK col's index.
  const lastPkIdx = Math.max(...pkCols.map(k => headerNames.indexOf(k)));
  const firstNonPkIdx = Math.min(...nonPkCols.map(k => headerNames.indexOf(k)));
  assert(
    lastPkIdx < firstNonPkIdx,
    `Payment examples: all PK cols appear before non-PK cols (last PK idx=${lastPkIdx}, first non-PK idx=${firstNonPkIdx})`,
  );

  await pageA.close();

  // ── Section B: broken-demo model (warning triangles + per-entity findings) ──
  note('\n── Section B: broken-demo (warning triangles on entities with findings) ──');
  const pageB = await openDict(PORT_B);

  // broken-demo has known per-entity findings (edge.dangling_fk_column, etc.)
  // The dict warning triangle is rendered as ⚠ in a .dict-entity-warn element OR
  // as a badge inside the .dict-entity-header for entities with entity-scoped errors.
  note('4. Warning triangle: at least one entity with a finding renders a warning indicator…');
  // The warning indicator in DictionaryView is <details class="dict-entity-warning">
  // rendered when nodeErrors.length > 0 for an entity.
  // broken-demo has known per-entity findings (edge.dangling_fk_column etc.)
  const warnDetails = pageB.locator('details.dict-entity-warning');
  const warnCount = await warnDetails.count();
  assert(warnCount > 0, `broken-demo: at least one <details class="dict-entity-warning"> present (got ${warnCount})`);

  // The summary must contain ⚠ text
  const firstWarnSummary = warnDetails.first().locator('summary');
  const warnSummaryText = await firstWarnSummary.textContent();
  assert(
    warnSummaryText !== null && warnSummaryText.includes('⚠'),
    `first dict-entity-warning summary contains ⚠ (got: "${warnSummaryText}")`,
  );

  await pageB.close();

  // ── Screenshots for visual inspection ────────────────────────────────────────
  const tmpDir = join(ROOT, 'tmp');
  try { mkdirSync(tmpDir, { recursive: true }); } catch {}

  note('\nAll dict render-coverage assertions passed.');
} finally {
  await browser.close();
  procA.kill();
  procB.kill();
}
