/** test-shortcut-actions.ts — Shift+L, R, Cmd/Ctrl+C copy link, Groups modal Hide/Show, Shift+H, flow L and R,
 *  driven by real keys in a browser on models/key-inherited. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { parseLayoutMode, prevLayoutMode } from '../../src/app/views/graph/graph-edits';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const REFERENCE_ENTITIES = ['LineItemType', 'PartyType', 'PaymentMethodType'];

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 120_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-shortcut-actions.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

async function waitForFirstLayout(page: Page) {
  await page.waitForFunction(() => (window.__IGNATIUS_PERF__?.layoutStopAt ?? 0) > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(300);
}

function hiddenIds(page: Page, ids: string[]) {
  return page.evaluate(
    nodeIds => nodeIds.filter(id => window.__IGNATIUS_CY__?.$id(id).hasClass('user-hidden')),
    ids,
  );
}

async function blurAll(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
  });
}

const handle = serveCommand(MODEL, { port: 0 });
const BASE = `http://localhost:${handle.server.port}`;

try {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const page = await context.newPage();
    await page.route('**/events', route => route.abort());
    await page.goto(`${BASE}/#view=graph`);
    await waitForFirstLayout(page);
    await blurAll(page);

    // 1. Shift+L — previous layout.
    const modeBefore = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
    await page.keyboard.press('Shift+L');
    await page.waitForFunction(
      before => localStorage.getItem('ignatius-layout-mode') !== before,
      modeBefore,
      { timeout: 5_000 },
    ).catch(() => null);
    const modeAfter = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode'));
    const expectedMode = prevLayoutMode(parseLayoutMode(modeBefore));
    assert(modeAfter === expectedMode, `FAIL 1: Shift+L should step ${modeBefore} back to ${expectedMode}, got ${modeAfter}`);
    console.log(`PASS 1: Shift+L stepped the layout ${modeBefore} → ${modeAfter}`);
    await page.waitForTimeout(1_500);

    // 2. R — re-run the layout; a node moved by hand goes back.
    const home = await page.evaluate(() => window.__IGNATIUS_CY__!.$id('Payment').position());
    await page.evaluate(({ x, y }) => window.__IGNATIUS_CY__!.$id('Payment').position({ x: x + 400, y: y + 400 }), home);
    await page.keyboard.press('r');
    await page.waitForFunction(
      ({ x, y }) => {
        const p = window.__IGNATIUS_CY__!.$id('Payment').position();
        return Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1;
      },
      home,
      { timeout: 10_000 },
    ).catch(() => null);
    const reset = await page.evaluate(() => window.__IGNATIUS_CY__!.$id('Payment').position());
    assert(
      Math.abs(reset.x - home.x) < 1 && Math.abs(reset.y - home.y) < 1,
      `FAIL 2: R should put Payment back at ${JSON.stringify(home)}, got ${JSON.stringify(reset)}`,
    );
    console.log('PASS 2: R reset the graph layout');

    // 3. Cmd/Ctrl+C with nothing selected copies the link.
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await blurAll(page);
    await page.keyboard.press('Control+c');
    await page.waitForFunction(() => document.querySelector('.fab-toast')?.textContent === 'Copied!', null, { timeout: 3_000 }).catch(() => null);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const href = await page.evaluate(() => location.href);
    assert(copied === href, `FAIL 3a: Ctrl+C should copy ${href}, clipboard holds ${copied}`);
    assert(await page.locator('.fab-toast').innerText() === 'Copied!', 'FAIL 3b: Ctrl+C shows the Copied! toast');
    console.log('PASS 3: Ctrl+C with no selection copied the link and showed the toast');

    // 4. Groups modal — Hide then Show the Reference group.
    await page.click('.fab');
    await page.getByRole('menuitem', { name: 'Groups' }).click();
    const dialog = page.getByRole('dialog', { name: 'Groups' });
    const referenceCard = dialog.locator('.group-card').filter({ has: page.locator('strong', { hasText: 'Reference / Enumerable' }) });
    await referenceCard.getByRole('button', { name: 'Hide' }).click();
    await page.waitForTimeout(300);
    const afterHide = await hiddenIds(page, REFERENCE_ENTITIES);
    assert(afterHide.length === REFERENCE_ENTITIES.length, `FAIL 4a: Hide should hide ${REFERENCE_ENTITIES.join(', ')}, hid ${afterHide.join(', ')}`);
    assert(await referenceCard.getByRole('button', { name: 'Show' }).isVisible(), 'FAIL 4b: a fully hidden group offers Show');
    await referenceCard.getByRole('button', { name: 'Show' }).click();
    await page.waitForTimeout(300);
    const afterShow = await hiddenIds(page, REFERENCE_ENTITIES);
    assert(afterShow.length === 0, `FAIL 4c: Show should restore the group, still hidden: ${afterShow.join(', ')}`);
    assert(await referenceCard.getByRole('button', { name: 'Hide' }).isVisible(), 'FAIL 4d: a visible group offers Hide');
    console.log('PASS 4: Groups modal Hide/Show hides and restores a whole group');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 5_000 });
    await blurAll(page);

    // 5. Shift+H — hide the selected entity's group; Cmd/Ctrl+Z brings it back.
    await page.evaluate(() => window.__IGNATIUS_CY__!.$id('PartyType').select());
    await page.keyboard.press('Shift+H');
    await page.waitForTimeout(300);
    const groupHidden = await hiddenIds(page, REFERENCE_ENTITIES);
    assert(groupHidden.length === REFERENCE_ENTITIES.length, `FAIL 5a: Shift+H should hide the Reference group, hid ${groupHidden.join(', ')}`);
    const othersHidden = await hiddenIds(page, ['Payment', 'Party', 'Product']);
    assert(othersHidden.length === 0, `FAIL 5b: Shift+H hides only that group, also hid ${othersHidden.join(', ')}`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const restored = await hiddenIds(page, REFERENCE_ENTITIES);
    assert(restored.length === 0, `FAIL 5c: one undo should restore the whole group, still hidden: ${restored.join(', ')}`);
    console.log('PASS 5: Shift+H hid the selected group in one undo step');

    // 6. Flow view — L and Shift+L flip per-process ↔ connected; R puts a moved node back.
    await page.keyboard.press('f');
    await page.waitForSelector('[data-ignatius="flow-svg"] > g', { timeout: 10_000 });
    await page.waitForTimeout(500);
    await blurAll(page);
    const flowViewMode = () => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('flowview') ?? 'per-process');
    const flowStart = await flowViewMode();
    await page.keyboard.press('l');
    await page.waitForTimeout(300);
    const flowAfterL = await flowViewMode();
    assert(flowAfterL !== flowStart, `FAIL 6a: L on the flow view should flip ${flowStart}, stayed ${flowAfterL}`);
    await page.keyboard.press('Shift+L');
    await page.waitForTimeout(300);
    const flowAfterShiftL = await flowViewMode();
    assert(flowAfterShiftL === flowStart, `FAIL 6b: Shift+L should flip back to ${flowStart}, got ${flowAfterShiftL}`);
    console.log(`PASS 6a: L and Shift+L flip the flow view (${flowStart} → ${flowAfterL} → ${flowAfterShiftL})`);

    await page.waitForSelector('[data-ignatius="flow-svg"] > g', { timeout: 10_000 });
    await page.waitForTimeout(500);
    const flowNode = page.locator('[data-ignatius="flow-svg"] g[data-token]:not(:has([data-has-sub-dfd]))').first();
    const flowHome = await flowNode.boundingBox();
    if (!flowHome) throw new Error('FAIL 6c: fixture: the flow diagram has a draggable node');
    await page.mouse.move(flowHome.x + flowHome.width / 2, flowHome.y + flowHome.height / 2);
    await page.mouse.down();
    await page.mouse.move(flowHome.x + flowHome.width / 2 + 200, flowHome.y + flowHome.height / 2 + 150, { steps: 8 });
    await page.mouse.up();
    const flowMoved = await flowNode.boundingBox();
    assert(
      flowMoved !== null && Math.abs(flowMoved.x - flowHome.x) > 50,
      `FAIL 6d: fixture: dragging should move the flow node, got ${JSON.stringify({ flowHome, flowMoved })}`,
    );
    await blurAll(page);
    await page.keyboard.press('r');
    await page.waitForFunction(({ x, y }) => {
      const r = document.querySelector('[data-ignatius="flow-svg"] g[data-token]:not(:has([data-has-sub-dfd]))')?.getBoundingClientRect();
      return r !== undefined && Math.abs(r.x - x) < 2 && Math.abs(r.y - y) < 2;
    }, flowHome, { timeout: 10_000 }).catch(() => null);
    const flowReset = await flowNode.boundingBox();
    assert(
      flowReset !== null && Math.abs(flowReset.x - flowHome.x) < 2 && Math.abs(flowReset.y - flowHome.y) < 2,
      `FAIL 6e: R on the flow view should put the dragged node back at ${JSON.stringify(flowHome)}, got ${JSON.stringify(flowReset)}`,
    );
    console.log('PASS 6b: R put the dragged flow node back');

    // 7. With text selected, Ctrl+C is the browser's copy.
    await page.keyboard.press('d');
    await page.waitForSelector('[data-ignatius="dict-view"]', { timeout: 5_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    const selectedText = await page.evaluate(() => {
      const heading = document.querySelector('[data-ignatius="dict-view"] h2, [data-ignatius="dict-view"] h3');
      if (!heading) return '';
      const range = document.createRange();
      range.selectNodeContents(heading);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? '';
    });
    assert(selectedText.length > 0, 'FAIL 7a: fixture: a dictionary heading is selectable');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);
    const clipboardWithSelection = await page.evaluate(() => navigator.clipboard.readText());
    const dictHref = await page.evaluate(() => location.href);
    assert(clipboardWithSelection !== dictHref, `FAIL 7b: Ctrl+C with a text selection must not copy the link (clipboard: ${clipboardWithSelection})`);
    console.log('PASS 7: Ctrl+C with a text selection leaves the native copy alone');

    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  clearTimeout(watchdog);
  handle.stop(true);
}

process.exit(process.exitCode ?? 0);
