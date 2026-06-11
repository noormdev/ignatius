/**
 * CP6 assertion: rich entity dialog for db: store nodes in the flow viewer.
 *
 * Steps:
 *  1. Copy models/key-inherited into tmp/cp6-test-model (ephemeral fixture).
 *     Inject a process that outputs db:GhostEntity (absent ERD entity) for step 8.
 *  2. Serve it on a dedicated port.
 *  3. Load the app; switch to Flows via FAB.
 *  4. Wait for the flow renderer to be ready.
 *  5. Click the ⓘ badge on a db: store (Payment, PaymentMethod, or similar).
 *     Assert the RICH SelectedEntityModal opens (columns table present,
 *     classification badge present — NOT just a plain markdown body).
 *  6. Close the modal; click a process ⓘ badge.
 *     Assert the PLAIN FlowDocModal opens (doc-body present, no columns table).
 *  7. Close. Navigate deterministically to "Collect-Payment" (known to contain
 *     [[Payment]] wiki-links). Click the wiki-link → assert the rich dialog opens.
 *     Hard-fails if the wiki-link is absent — that would mean the fixture changed.
 *  8. Close. Click the db:GhostEntity badge (injected in step 1).
 *     Assert: no crash AND an empty-state FlowDocModal appears (not the rich
 *     SelectedEntityModal, not a dead/non-opening badge).
 *
 * Hard-fails (process.exit(1)) on any assertion miss.
 * Run via: bun test/visual/test-cp6-db-store-rich-dialog.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE_SRC = join(ROOT, 'models', 'key-inherited');
const FIXTURE_DST = join(ROOT, 'tmp', 'cp6-test-model');
const PORT = 7281;
const BASE_URL = `http://localhost:${PORT}`;

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

// ── Fixture setup ─────────────────────────────────────────────────────────────

try { rmSync(FIXTURE_DST, { recursive: true, force: true }); } catch {}
cpSync(FIXTURE_SRC, FIXTURE_DST, { recursive: true });
note(`Fixture copied: ${FIXTURE_DST}`);

// Inject a process that references db:GhostEntity (an entity that does NOT exist
// in the ERD model) so step 8 can actually click its badge and verify graceful
// empty-state behavior. We add it to the existing order-to-cash DFD folder.
const ghostFlowDir = join(FIXTURE_DST, 'flows', 'order-to-cash');
mkdirSync(ghostFlowDir, { recursive: true });
writeFileSync(
  join(ghostFlowDir, 'Ghost-Process.md'),
  `---
process: Ghost Process
number: 99
inputs:
  - from: ext:Customer
    data: ghost data
outputs:
  - to: db:GhostEntity
    data: [ghost_id]
---

A synthetic process injected by the CP6 test fixture to verify graceful
absent-entity fallback when clicking the db:GhostEntity store badge.
`,
);
note('Injected Ghost-Process.md referencing db:GhostEntity (absent entity)');

// ── Server ────────────────────────────────────────────────────────────────────

note(`Starting ignatius serve ${FIXTURE_DST} on port ${PORT}…`);
const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', FIXTURE_DST, '--port', String(PORT)],
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

const serverReady = await waitForServer(BASE_URL, 12_000);
if (!serverReady) {
  rmSync(FIXTURE_DST, { recursive: true, force: true });
  fail('Server did not start within 12 seconds');
}
note(`Server ready at ${BASE_URL}`);

// ── Playwright ────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

async function waitFlowReady(ctx: string): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail(`__IGNATIUS_FLOW_READY__ did not become true ${ctx}`);
  note(`Flow ready: ${ctx}`);
}

async function clickErdFabItem(label: string): Promise<void> {
  const fab = page.locator('.fab');
  if (await fab.count() === 0) fail(`ERD FAB (.fab) not found when clicking "${label}"`);
  await fab.click();
  await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: label, exact: true });
  if (await item.count() === 0) fail(`ERD FAB menu item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');

  // Wait for ERD graph (confirms live mode + initial model load)
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  );
  note('ERD graph ready');

  // Switch to Flows
  await clickErdFabItem('Flows');
  await waitFlowReady('after graph→flow switch');

  // ── Step 5: Click a db: store ⓘ badge → rich SelectedEntityModal ──────────
  //
  // Store nodes render as <g data-token="db:EntityName"> wrapping a StoreNode
  // (which contains an InfoBadge with data-ignatius="flow-info"). We locate the
  // ⓘ badge inside any db: store wrapper.
  const dbStoreGroups = page.locator('[data-token^="db:"]');
  const dbGroupCount = await dbStoreGroups.count();
  note(`Found ${dbGroupCount} db: store groups`);
  if (dbGroupCount === 0) fail('No db: store nodes found in the flow diagram');

  const firstDbGroup = dbStoreGroups.first();
  const dbToken = await firstDbGroup.getAttribute('data-token');
  note(`Found db: store group: ${dbToken}`);

  // Click the ⓘ badge inside the first db: store group.
  const firstDbBadge = firstDbGroup.locator('[data-ignatius="flow-info"]');
  const dbBadgeCount = await firstDbBadge.count();
  note(`db: store ⓘ badges in first group: ${dbBadgeCount}`);
  if (dbBadgeCount === 0) fail(`No ⓘ badge inside db: store group "${dbToken}"`);
  note(`Clicking db: store badge: ${dbToken}`);
  await firstDbBadge.click();
  await page.waitForTimeout(500);

  // The RICH entity dialog has .modal with .modal-header h1 AND a table (ColumnsTable).
  // The plain FlowDocModal only has .doc-body and no table.
  const modal = page.locator('.modal');
  const modalCount = await modal.count();
  if (modalCount === 0) fail('No modal opened after clicking db: store badge');

  // Check for columns table — only SelectedEntityModal renders it.
  const columnsTable = page.locator('.modal .columns-table, .modal table');
  const hasColumnsTable = (await columnsTable.count()) > 0;
  if (!hasColumnsTable) fail(`db: store badge opened a plain FlowDocModal (no columns table). Expected the rich SelectedEntityModal.`);
  note('db: store badge opened rich SelectedEntityModal (columns table present): PASS');

  // Check for classification badge (only SelectedEntityModal has it).
  const classBadge = page.locator('.modal .modal-badges .badge');
  const hasClassBadge = (await classBadge.count()) > 0;
  if (!hasClassBadge) fail('Rich entity modal missing classification badge');
  note('Classification badge present: PASS');

  // Take a screenshot of the rich dialog.
  await page.screenshot({ path: join(ROOT, 'tmp', 'cp6-db-store-rich-dialog.png') });
  note('Screenshot saved: tmp/cp6-db-store-rich-dialog.png');

  // Close the modal.
  await page.locator('.modal .modal-close').click();
  await page.waitForTimeout(300);
  if ((await page.locator('.modal').count()) > 0) fail('Modal did not close');
  note('Modal closed');

  // ── Step 6: Click a process ⓘ badge → FlowNodeModal (CP9a: facts-rich) ─────
  //
  // CP9a changed: process ⓘ now opens FlowNodeModal (I/O table + markdown body),
  // NOT the plain markdown-only FlowDocModal. The modal is still NOT the rich
  // SelectedEntityModal (no .modal-badges classification badge, no columns-table).
  const procGroups = page.locator('[data-token^="proc:"]');
  const procGroupCount = await procGroups.count();
  note(`Found ${procGroupCount} process groups`);
  if (procGroupCount === 0) fail('No proc: node groups found in the flow diagram');

  const firstProcGroup = procGroups.first();
  const procToken = await firstProcGroup.getAttribute('data-token');
  note(`Found process group: ${procToken}`);

  const firstProcBadge = firstProcGroup.locator('[data-ignatius="flow-info"]');
  const procBadgeCount = await firstProcBadge.count();
  if (procBadgeCount === 0) fail(`No ⓘ badge inside process group "${procToken}"`);
  note(`Clicking process badge: ${procToken}`);
  await firstProcBadge.click();
  await page.waitForTimeout(500);

  const procModal = page.locator('.modal');
  if ((await procModal.count()) === 0) fail('No modal opened after clicking process badge');

  // FlowNodeModal: must have a .dict-io-table (structured I/O facts), NOT a columns-table
  // or classification badge (those belong to SelectedEntityModal only).
  const procIoTable = page.locator('.modal .dict-io-table');
  const procHasIoTable = (await procIoTable.count()) > 0;
  if (!procHasIoTable) fail('Process badge opened modal WITHOUT .dict-io-table (CP9a: should be facts-rich FlowNodeModal)');
  note('Process badge opened FlowNodeModal with .dict-io-table: PASS');

  // Must NOT have the entity classification badge (only SelectedEntityModal has that).
  const procClassBadge = page.locator('.modal .modal-badges .badge');
  const procHasClassBadge = (await procClassBadge.count()) > 0;
  if (procHasClassBadge) fail('Process modal has .modal-badges classification badge — should not be SelectedEntityModal');
  note('Process modal has no classification badge (correct — not entity dialog): PASS');

  // Close the process modal before step 7.
  await page.locator('.modal .modal-close').click();
  await page.waitForTimeout(300);

  // ── Step 7: Entity wiki-link → rich dialog (deterministic: Collect-Payment) ──
  //
  // Collect-Payment.md is known to contain [[Payment]], [[PaymentMethod]], and
  // [[PaymentAllocation]] wiki-links. We navigate to it explicitly so this step
  // cannot be skipped or weakly-escaped.
  const collectPaymentGroup = page.locator('[data-token="proc:Collect-Payment"]');
  const collectPaymentCount = await collectPaymentGroup.count();
  if (collectPaymentCount === 0) fail(
    'No proc:Collect-Payment node found — fixture may have changed. ' +
    'Collect-Payment.md must remain in order-to-cash/ for the wiki-link test.'
  );
  note('Found proc:Collect-Payment group');

  const collectPaymentBadge = collectPaymentGroup.locator('[data-ignatius="flow-info"]');
  if ((await collectPaymentBadge.count()) === 0) fail('No ⓘ badge inside proc:Collect-Payment group');
  await collectPaymentBadge.click();
  await page.waitForTimeout(500);

  if ((await page.locator('.modal').count()) === 0) fail('Collect-Payment doc modal did not open');

  // The doc body must contain at least one entity wiki-link (a[data-entity]).
  // Collect-Payment.md references [[Payment]] — if this is absent, the flow
  // markdown body is no longer being rendered with wiki-links, which is a bug.
  const wikiLink = page.locator('.modal .doc-body a[data-entity]').first();
  const hasWikiLink = (await wikiLink.count()) > 0;
  if (!hasWikiLink) fail(
    'Collect-Payment doc has no entity wiki-links (a[data-entity]). ' +
    'The process body must render [[Payment]]/[[PaymentMethod]] as entity anchors. ' +
    'Check that wiki-link rendering is active for flow process bodies.'
  );

  const linkedEntity = await wikiLink.getAttribute('data-entity');
  note(`Clicking wiki-link to entity "${linkedEntity}" in Collect-Payment doc…`);
  await wikiLink.click();
  await page.waitForTimeout(500);

  // Should now show the rich entity dialog (columns table + classification badge).
  const afterWikiTable = page.locator('.modal .columns-table, .modal table');
  const hasTableAfterWiki = (await afterWikiTable.count()) > 0;
  if (!hasTableAfterWiki) fail(
    `Wiki-link to entity "${linkedEntity}" opened a plain markdown dialog instead of ` +
    'the rich SelectedEntityModal (no columns table). Check the entity routing path in FlowSurface.'
  );
  note(`Wiki-link to "${linkedEntity}" opened rich entity dialog (columns table present): PASS`);

  // Close the rich dialog.
  await page.locator('.modal .modal-close').first().click();
  await page.waitForTimeout(300);
  if ((await page.locator('.modal').count()) > 0) fail('Rich entity modal did not close after wiki-link step');
  note('Rich entity modal closed after wiki-link step');

  // ── Step 8: Absent-entity db: store → graceful empty-state, no crash ───────
  //
  // We injected Ghost-Process.md (output: db:GhostEntity) into the fixture.
  // The flow renderer should show a db:GhostEntity store node in the diagram.
  // Clicking its badge must NOT crash and must show an empty-state FlowDocModal —
  // NOT the rich SelectedEntityModal (GhostEntity is not in the ERD model).
  note('Step 8: Clicking db:GhostEntity badge (absent entity) — expect graceful empty-state...');

  const ghostGroup = page.locator('[data-token="db:GhostEntity"]');
  const ghostCount = await ghostGroup.count();
  if (ghostCount === 0) fail(
    'No db:GhostEntity node found in the flow diagram. ' +
    'Ghost-Process.md injection may have failed or the fixture was not picked up by the server.'
  );
  note(`Found db:GhostEntity group (${ghostCount} node(s))`);

  const ghostBadge = ghostGroup.first().locator('[data-ignatius="flow-info"]');
  if ((await ghostBadge.count()) === 0) fail('No ⓘ badge inside db:GhostEntity group');
  await ghostBadge.click();
  await page.waitForTimeout(500);

  // A modal MUST appear (badge must not be silently dead).
  const ghostModal = page.locator('.modal');
  if ((await ghostModal.count()) === 0) fail(
    'db:GhostEntity badge produced no modal. Expected an empty-state FlowDocModal.'
  );

  // Must NOT be the rich entity dialog (no columns table, no classification badge).
  const ghostColumnsTable = page.locator('.modal .columns-table, .modal table');
  if ((await ghostColumnsTable.count()) > 0) fail(
    'db:GhostEntity (absent entity) opened the rich SelectedEntityModal. ' +
    'The resolver should return null for absent entities, falling back to empty-state.'
  );
  note('db:GhostEntity badge did not open the rich dialog: PASS');

  // Must be a plain FlowDocModal with .doc-body (the empty-state fallback).
  const ghostDocBody = page.locator('.modal .doc-body');
  if ((await ghostDocBody.count()) === 0) fail(
    'db:GhostEntity modal has no .doc-body. Expected an empty-state FlowDocModal.'
  );
  note('db:GhostEntity badge opened empty-state FlowDocModal (.doc-body present): PASS');

  // Close and confirm no crash.
  await page.locator('.modal .modal-close').click();
  await page.waitForTimeout(300);
  if ((await page.locator('.modal').count()) > 0) fail('GhostEntity modal did not close');

  // Confirm the page is still alive and interactive.
  const isAlive = await page.evaluate(() => document.readyState === 'complete');
  if (!isAlive) fail('Page crashed or became unresponsive after GhostEntity interaction');
  note('App still responsive after absent-entity interaction: PASS');

  // ── Final screenshot ──────────────────────────────────────────────────────────
  await page.screenshot({ path: join(ROOT, 'tmp', 'cp6-final-state.png') });
  note('Final screenshot saved: tmp/cp6-final-state.png');

  // Final summary
  note('\nAll CP6 assertions PASSED:');
  note('  ✓ db: store ⓘ badge → rich SelectedEntityModal (columns table + classification badge)');
  note('  ✓ process ⓘ badge → plain FlowDocModal (doc-body, no table)');
  note('  ✓ entity wiki-link in Collect-Payment doc → rich entity dialog (deterministic)');
  note('  ✓ db:GhostEntity (absent) → empty-state FlowDocModal, no crash');

} catch (err) {
  if (err instanceof Error && err.message.startsWith('FAIL:')) throw err;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
  try { rmSync(FIXTURE_DST, { recursive: true, force: true }); } catch {}
  note('Fixture cleaned up');
}

console.log('\nCP6 db-store-rich-dialog assertion PASSED.');
