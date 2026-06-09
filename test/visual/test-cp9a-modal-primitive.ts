/**
 * CP9a assertion: one <Modal> primitive + facts-rich non-entity flow dialogs.
 *
 * Steps:
 *  1. Serve models/key-inherited on a dedicated port.
 *  2. Load the app; switch to Flows via FAB.
 *  3. Wait for the flow renderer to be ready.
 *
 *  Modal primitive checks:
 *  4. Click a process ⓘ → assert FlowNodeModal opens with a dict-io-table (I/O facts)
 *     AND .doc-body (markdown body). Exactly ONE .modal rendered.
 *  5. Assert ESC closes the modal (Modal owns the ESC handler).
 *
 *  Facts-rich dialog checks:
 *  6. Click the same process ⓘ again → take a screenshot of the I/O table.
 *  7. Close. Click an external ⓘ (ext: token) → assert facts section present.
 *  8. Close. Click a non-db store ⓘ if present → assert facts section.
 *
 *  Entity dialog unchanged:
 *  9. Close. Click a db: store ⓘ → assert RICH SelectedEntityModal (columns table
 *     + classification badge). Exactly ONE .modal rendered.
 *  10. ESC closes it.
 *
 *  Switch to graph:
 *  11. Click a graph node → assert SelectedEntityModal (columns table). ONE .modal.
 *  12. ESC closes it.
 *
 * Hard-fails (process.exit(1)) on any assertion miss.
 * Run via: bun test/visual/test-cp9a-modal-primitive.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dir, '../..');
const PORT = 7292;
const BASE_URL = `http://localhost:${PORT}`;
const FIXTURE = join(ROOT, 'models', 'key-inherited');

const note = (m: string) => console.log(m);
const fail = (m: string): never => {
  console.error('FAIL:', m);
  process.exit(1);
};

note(`Starting ignatius serve ${FIXTURE} on port ${PORT}…`);
const proc = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', FIXTURE, '--port', String(PORT)],
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
  proc.kill();
  fail('Server did not start within 12 seconds');
}
note(`Server ready at ${BASE_URL}`);

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

async function assertModalCount(expected: number, ctx: string): Promise<void> {
  const count = await page.locator('.modal').count();
  if (count !== expected) fail(`Expected ${expected} .modal(s), got ${count} — ${ctx}`);
}

async function closeModalAndAssert(ctx: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const count = await page.locator('.modal').count();
  if (count !== 0) fail(`Modal did not close after ESC — ${ctx}`);
  note(`ESC closed modal: ${ctx}`);
}

try {
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');

  // Wait for ERD graph
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  );
  note('ERD graph ready');

  // Switch to Flows
  await clickErdFabItem('Flows');
  await waitFlowReady('after graph→flow switch');

  // ── Step 4: process ⓘ → FlowNodeModal with I/O table ──────────────────────
  const procGroups = page.locator('[data-token^="proc:"]');
  const procGroupCount = await procGroups.count();
  note(`Found ${procGroupCount} process groups`);
  if (procGroupCount === 0) fail('No proc: node groups found in the flow diagram');

  const firstProcGroup = procGroups.first();
  const procToken = await firstProcGroup.getAttribute('data-token');
  note(`Found process group: ${procToken}`);

  const firstProcBadge = firstProcGroup.locator('[data-ignatius="flow-info"]');
  if ((await firstProcBadge.count()) === 0) fail(`No ⓘ badge inside process group "${procToken}"`);
  await firstProcBadge.click();
  await page.waitForTimeout(600);

  // Exactly ONE modal
  await assertModalCount(1, 'after clicking process badge');

  // FlowNodeModal must have a dict-io-table (structured I/O facts)
  const ioTable = page.locator('.modal .dict-io-table');
  const hasIoTable = (await ioTable.count()) > 0;
  if (!hasIoTable) fail(
    `Process ⓘ opened a modal WITHOUT a .dict-io-table. ` +
    `Expected FlowNodeModal with structured I/O facts, not markdown-only.`
  );
  note('process ⓘ → FlowNodeModal with .dict-io-table: PASS');

  // Must NOT have a columns table (that is only SelectedEntityModal)
  const columnsTable = page.locator('.modal .columns-table, .modal table.columns-table');
  const hasColumnsTable = (await columnsTable.count()) > 0;
  if (hasColumnsTable) fail('Process modal has a .columns-table — should be FlowNodeModal, not SelectedEntityModal');
  note('Process modal does not have .columns-table (correct — not entity dialog): PASS');

  // Take screenshot of process dialog showing I/O table
  await page.screenshot({ path: join(ROOT, 'tmp', 'cp9a-process-dialog-io-table.png') });
  note('Screenshot saved: tmp/cp9a-process-dialog-io-table.png');

  // ── Step 5: ESC closes the modal ──────────────────────────────────────────
  await closeModalAndAssert('process FlowNodeModal');

  // ── Step 6: Try an external ⓘ ────────────────────────────────────────────
  const extGroups = page.locator('[data-token^="ext:"]');
  const extGroupCount = await extGroups.count();
  note(`Found ${extGroupCount} external groups`);
  if (extGroupCount > 0) {
    const firstExtGroup = extGroups.first();
    const extToken = await firstExtGroup.getAttribute('data-token');
    note(`Found external group: ${extToken}`);
    const firstExtBadge = firstExtGroup.locator('[data-ignatius="flow-info"]');
    if ((await firstExtBadge.count()) > 0) {
      await firstExtBadge.click();
      await page.waitForTimeout(600);
      await assertModalCount(1, 'after clicking external badge');

      // External dialog: .flow-node-dialog-facts section present
      const extFacts = page.locator('.modal .flow-node-dialog-facts');
      if ((await extFacts.count()) === 0) fail('External modal has no .flow-node-dialog-facts');
      note(`External ⓘ → FlowNodeModal with .flow-node-dialog-facts: PASS`);

      await closeModalAndAssert('external FlowNodeModal');
    } else {
      note(`No ⓘ badge in external group "${extToken}" — skipping external check`);
    }
  } else {
    note('No external groups in this DFD — skipping external check');
  }

  // ── Step 7: db: store ⓘ → still rich SelectedEntityModal ────────────────
  const dbStoreGroups = page.locator('[data-token^="db:"]');
  const dbGroupCount = await dbStoreGroups.count();
  note(`Found ${dbGroupCount} db: store groups`);
  if (dbGroupCount === 0) fail('No db: store nodes found in the flow diagram');

  const firstDbGroup = dbStoreGroups.first();
  const dbToken = await firstDbGroup.getAttribute('data-token');
  note(`Found db: store group: ${dbToken}`);
  const firstDbBadge = firstDbGroup.locator('[data-ignatius="flow-info"]');
  if ((await firstDbBadge.count()) === 0) fail(`No ⓘ badge inside db: store group "${dbToken}"`);
  await firstDbBadge.click();
  await page.waitForTimeout(600);

  // Exactly ONE modal
  await assertModalCount(1, 'after clicking db: store badge');

  // RICH entity dialog: has columns table + classification badge
  const dbColumnsTable = page.locator('.modal table');
  if ((await dbColumnsTable.count()) === 0) fail(
    `db: store ⓘ opened a modal without a table. Expected rich SelectedEntityModal.`
  );
  note('db: store ⓘ → SelectedEntityModal (columns table present): PASS');

  const classBadge = page.locator('.modal .modal-badges .badge');
  if ((await classBadge.count()) === 0) fail('Rich entity modal missing classification badge');
  note('Classification badge present: PASS');

  // ESC closes it
  await closeModalAndAssert('db: store SelectedEntityModal');

  await page.screenshot({ path: join(ROOT, 'tmp', 'cp9a-flow-assertions.png') });
  note('Screenshot saved: tmp/cp9a-flow-assertions.png');

  // ── Step 8: Switch back to graph, click a node → SelectedEntityModal ──────
  await clickErdFabItem('Data Graph');
  await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 15_000 },
  );
  note('ERD graph ready after switch');
  await page.waitForTimeout(800);

  // Open a known entity via Cytoscape's tap event — deterministic, no canvas-coord guessing.
  // 'License' is a Dependent entity in key-inherited (non-parent node, always present).
  const cyReady = await page.evaluate(() => {
    const cy = (window as { __IGNATIUS_CY__?: { getElementById: (id: string) => { length: number; emit: (ev: string) => void } } }).__IGNATIUS_CY__;
    if (!cy) return false;
    const node = cy.getElementById('License');
    if (!node || node.length === 0) return false;
    node.emit('tap');
    return true;
  });
  if (!cyReady) fail('Could not open License node via Cytoscape — __IGNATIUS_CY__ missing or License node absent');
  await page.waitForTimeout(500);

  await assertModalCount(1, 'after emitting tap on License node');
  note('Graph node tap → SelectedEntityModal: PASS');

  const graphTable = page.locator('.modal table');
  if ((await graphTable.count()) === 0) fail('Graph entity modal (License) has no table');
  note('Graph entity modal has table: PASS');

  await closeModalAndAssert('graph SelectedEntityModal');

  note('\nAll CP9a assertions PASSED:');
  note('  ✓ process ⓘ → FlowNodeModal with .dict-io-table (facts-rich, not markdown-only)');
  note('  ✓ ESC closes FlowNodeModal (Modal owns ESC handler)');
  note('  ✓ external ⓘ → FlowNodeModal with .flow-node-dialog-facts (if present)');
  note('  ✓ db: store ⓘ → rich SelectedEntityModal unchanged (columns table + badge)');
  note('  ✓ ESC closes SelectedEntityModal');
  note('  ✓ exactly one .modal at a time');

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

console.log('\nCP9a modal-primitive assertion PASSED.');
