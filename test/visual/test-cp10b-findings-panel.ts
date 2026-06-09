/**
 * Visual verification: CP10b — one FindingsPanel on all views, hidden when empty.
 *
 * Proves:
 *  1. Flow view with 0 flow findings (key-inherited): NO .findings-panel rendered, NO
 *     .flow-findings-aside or any "0 findings" / "No issues found" text.
 *  2. Graph view with entity findings (broken-demo): .findings-panel is present.
 *  3. Flow view with a flow.unknown_store finding injected into a tmp copy of key-inherited:
 *     .findings-panel IS present, contains "flow.unknown_store", no legacy FindingsAside.
 *  4. FlowChrome's FindingsAside is gone from the DOM entirely.
 *
 * NOT run by `bun run test` — manual visual check only.
 * Run: bun test/visual/test-cp10b-findings-panel.ts
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, cpSync, rmSync, writeFileSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp', 'cp10b-findings-panel');
mkdirSync(TMP, { recursive: true });

const note = (m: string) => console.log(m);
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function waitForGraph(page: import('playwright').Page): Promise<void> {
  const ok = await page.waitForFunction(
    () => !!(window as { __IGNATIUS_CY__?: unknown }).__IGNATIUS_CY__,
    { timeout: 12_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Graph (__IGNATIUS_CY__) did not become ready');
}

async function waitForFlow(page: import('playwright').Page): Promise<void> {
  const ok = await page.waitForFunction(
    () => (window as { __IGNATIUS_FLOW_READY__?: boolean }).__IGNATIUS_FLOW_READY__ === true,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  if (!ok) fail('Flow (__IGNATIUS_FLOW_READY__) did not become ready');
}

async function openFab(page: import('playwright').Page): Promise<void> {
  await page.locator('.fab').click();
  await page.waitForTimeout(300);
}

async function clickFabItem(page: import('playwright').Page, label: string): Promise<void> {
  const item = page.getByRole('menuitem', { name: label, exact: true });
  const count = await item.count();
  if (count === 0) fail(`FAB item "${label}" not found`);
  await item.click();
  await page.waitForTimeout(500);
}

// ── Test 1: key-inherited → flow view → NO findings box ──────────────────────

note('\n═══ Test 1: key-inherited flow view — NO findings panel (0 flow findings) ═══');

const PORT1 = 7410;
const proc1 = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/key-inherited', '--port', String(PORT1)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

const server1Ready = await waitForServer(`http://localhost:${PORT1}`, 12_000);
if (!server1Ready) { proc1.kill(); fail('Server 1 did not start'); }
note(`Server ready at http://localhost:${PORT1}`);

const browser = await chromium.launch();
const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page1 = await context1.newPage();

try {
  await page1.goto(`http://localhost:${PORT1}/`);
  await page1.waitForLoadState('domcontentloaded');
  await waitForGraph(page1);

  // Switch to flow view
  await openFab(page1);
  await clickFabItem(page1, 'Flows');
  await waitForFlow(page1);

  await page1.waitForTimeout(600);

  // Assert: NO .findings-panel rendered
  const panelCount = await page1.locator('.findings-panel').count();
  if (panelCount > 0) {
    await page1.screenshot({ path: join(TMP, '01-fail-findings-on-flow-clean.png') });
    fail(`Flow view with 0 findings still renders .findings-panel (count: ${panelCount})`);
  }
  note('OK: No .findings-panel on flow view with 0 flow findings');

  // Assert: NO "0 findings" / "No issues found" text
  const zeroText = await page1.locator('text="0 findings"').count();
  const noIssues = await page1.locator('text="No issues found"').count();
  if (zeroText > 0 || noIssues > 0) {
    await page1.screenshot({ path: join(TMP, '01-fail-zero-findings-text.png') });
    fail(`Flow view shows useless "0 findings" or "No issues found" text`);
  }
  note('OK: No "0 findings" or "No issues found" text on flow view');

  const shot1 = join(TMP, '01-flow-clean-no-findings.png');
  await page1.screenshot({ path: shot1 });
  note(`Screenshot: ${shot1}`);

} finally {
  await context1.close();
  proc1.kill();
}

// ── Test 2: broken-demo → graph view → .findings-panel visible ────────────────

note('\n═══ Test 2: broken-demo graph view — .findings-panel IS visible ═══');

const PORT2 = 7411;
const proc2 = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', 'models/broken-demo', '--port', String(PORT2)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

const server2Ready = await waitForServer(`http://localhost:${PORT2}`, 12_000);
if (!server2Ready) { proc2.kill(); fail('Server 2 did not start'); }
note(`Server ready at http://localhost:${PORT2}`);

const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await context2.newPage();

try {
  await page2.goto(`http://localhost:${PORT2}/`);
  await page2.waitForLoadState('domcontentloaded');
  await waitForGraph(page2);
  await page2.waitForTimeout(600);

  // Assert: .findings-panel IS present (broken-demo has entity findings)
  const panelCount = await page2.locator('.findings-panel').count();
  if (panelCount === 0) {
    await page2.screenshot({ path: join(TMP, '02-fail-no-findings-panel.png') });
    fail('broken-demo graph view: .findings-panel NOT found — expected entity findings');
  }
  note(`OK: .findings-panel present on graph view (count: ${panelCount})`);

  const shot2 = join(TMP, '02-graph-findings-panel.png');
  await page2.screenshot({ path: shot2 });
  note(`Screenshot: ${shot2}`);

} finally {
  await context2.close();
  proc2.kill();
}

// ── Test 3: model with flow findings → flow view → .findings-panel shows them ──
//
// Strategy: copy key-inherited to a tmp dir, inject a process .md that references
// db:GhostEntity (absent from entity catalog) → fires flow.unknown_store (Class B).
// Serve the tmp copy, switch to flow view, and HARD-assert:
//   a) .findings-panel exists (not hidden)
//   b) it contains "flow.unknown_store" text
//   c) no legacy FindingsAside (absolute top:58px) exists
// Then clean up the tmp copy.

note('\n═══ Test 3: flow finding → .findings-panel on flow view (positive assertion) ═══');

const FIXTURE_SRC3 = join(ROOT, 'models', 'key-inherited');
const FIXTURE_DST3 = join(ROOT, 'tmp', 'cp10b-flow-finding-model');

// Fresh copy each run
try { rmSync(FIXTURE_DST3, { recursive: true, force: true }); } catch {}
cpSync(FIXTURE_SRC3, FIXTURE_DST3, { recursive: true });
note(`Fixture copied: ${FIXTURE_DST3}`);

// Plant a process .md that references db:GhostEntity — not in the entity catalog.
// This reliably fires flow.unknown_store (Class B: severity=error).
const violationPath = join(FIXTURE_DST3, 'flows', 'order-to-cash', 'Ghost-Store-Process.md');
writeFileSync(violationPath, [
  '---',
  'process: Ghost Store Process',
  'number: 99',
  'outputs:',
  '  - to: db:GhostEntity',
  '    data: some field',
  '---',
  '',
  'This process intentionally references a non-existent entity to fire flow.unknown_store.',
].join('\n'), 'utf8');
note(`Injected violation: ${violationPath}`);

const PORT3 = 7412;
const proc3 = Bun.spawn(
  ['bun', 'src/cli.ts', 'serve', FIXTURE_DST3, '--port', String(PORT3)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

const server3Ready = await waitForServer(`http://localhost:${PORT3}`, 12_000);
if (!server3Ready) {
  proc3.kill();
  rmSync(FIXTURE_DST3, { recursive: true, force: true });
  fail('Server 3 did not start');
}
note(`Server ready at http://localhost:${PORT3}`);

const context3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page3 = await context3.newPage();

try {
  await page3.goto(`http://localhost:${PORT3}/`);
  await page3.waitForLoadState('domcontentloaded');
  await waitForGraph(page3);

  // Switch to flow view
  await openFab(page3);
  await clickFabItem(page3, 'Flows');
  await waitForFlow(page3);
  await page3.waitForTimeout(800);

  // Positive assertion a): .findings-panel MUST be present (flow finding → non-zero total)
  const panelCount = await page3.locator('.findings-panel').count();
  if (panelCount === 0) {
    await page3.screenshot({ path: join(TMP, '03-fail-no-findings-panel-on-flow-view.png') });
    fail(
      'POSITIVE assertion failed: flow view with flow.unknown_store finding has NO .findings-panel. ' +
      'The flow finding is not surfacing in the shared FindingsPanel — this is a real bug.',
    );
  }
  note(`OK: .findings-panel present on flow view with flow finding (count: ${panelCount})`);

  // Positive assertion b): panel text must include the rule id
  const panelText = await page3.locator('.findings-panel').first().textContent();
  const hasRuleId = (panelText ?? '').includes('flow.unknown_store');
  if (!hasRuleId) {
    await page3.screenshot({ path: join(TMP, '03-fail-missing-rule-in-panel.png') });
    fail(
      `POSITIVE assertion failed: .findings-panel exists but does not contain "flow.unknown_store". ` +
      `Panel text: ${panelText?.slice(0, 200)}`,
    );
  }
  note('OK: .findings-panel contains "flow.unknown_store" rule id');

  // Negative assertion c): no legacy FindingsAside (position:absolute top:58px right:62px)
  const asideCount = await page3.evaluate(() => {
    const els = document.querySelectorAll('aside');
    let matched = 0;
    for (const el of els) {
      const s = el.style;
      if (s.position === 'absolute' && s.top === '58px' && s.right === '62px') matched++;
    }
    return matched;
  });
  if (asideCount > 0) {
    await page3.screenshot({ path: join(TMP, '03-fail-findings-aside-still-present.png') });
    fail(`FindingsAside element (position:absolute top:58px right:62px) still in DOM (count: ${asideCount})`);
  }
  note('OK: FindingsAside (position:absolute top:58px right:62px) not in DOM');

  // Negative assertion d): no legacy .flow-findings* class
  const legacyAside = await page3.locator('[class*="flow-findings"]').count();
  if (legacyAside > 0) {
    fail(`Found legacy flow-findings class elements (count: ${legacyAside})`);
  }
  note('OK: No legacy .flow-findings* class elements on flow view');

  const shot3 = join(TMP, '03-flow-findings-in-panel.png');
  await page3.screenshot({ path: shot3 });
  note(`Screenshot: ${shot3}`);

} finally {
  await context3.close();
  proc3.kill();
  try { rmSync(FIXTURE_DST3, { recursive: true, force: true }); } catch {}
  note('Fixture cleaned up');
}

await browser.close();

note('\n═══ All CP10b findings-panel checks passed ═══');
