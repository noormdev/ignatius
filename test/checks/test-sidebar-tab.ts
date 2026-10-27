/** test-sidebar-tab.ts — the Dictionary's edge tab opens the sidebar, its close button brings the tab back, and the open state survives a reload. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'node:fs';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const TMP = join(ROOT, 'tmp');
const PORT = 7471;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1280, height: 900 };

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-sidebar-tab.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

const TAB = 'button.dict-nav-tab';
const PANEL = '.dict-nav-panel';

function tabBox(page: Page) {
  return page.locator(TAB).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom };
  });
}

function contentOpacity(page: Page) {
  return page.locator(`${TAB} .dict-nav-tab-content`).evaluate(el => getComputedStyle(el).opacity);
}

// The panel slides out by transform, so "open" means it sits inside the viewport.
function panelOnScreen(page: Page) {
  return page.locator(PANEL).evaluate(el => el.getBoundingClientRect().left < window.innerWidth - 1);
}

function focusedLabel(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
}

async function settle(page: Page) {
  await page.waitForTimeout(300);
}

mkdirSync(TMP, { recursive: true });
const handle = serveCommand(FIXTURE, { port: PORT });

try {
  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      try {
        await ctx.addInitScript(t => localStorage.setItem('ignatius-theme', t), theme);
        const page = await ctx.newPage();
        const pageErrors: string[] = [];
        page.on('pageerror', e => pageErrors.push(String(e)));
        await page.route('**/events', route => route.abort());

        await page.goto(`${BASE}/#view=dict`);
        await page.waitForSelector('.dict-view', { timeout: 15_000 });
        const tab = page.locator(TAB);
        await tab.waitFor({ state: 'visible', timeout: 5_000 });
        await page.mouse.move(10, 10);
        await settle(page);

        assert(await tab.getAttribute('aria-label') === 'Open sidebar', `FAIL: [${theme}] the tab is labelled "Open sidebar"`);
        assert((await tab.innerText()).includes('Sidebar'), `FAIL: [${theme}] the tab reads "Sidebar"`);
        assert(await tab.locator('svg').count() === 1, `FAIL: [${theme}] the tab carries one icon`);

        const rest = await tabBox(page);
        const lip = VIEWPORT.width - rest.left;
        assert(lip >= 10 && lip <= 16, `FAIL: [${theme}] at rest a 10-16px lip of the tab shows, got ${lip}px of ${rest.width}px`);
        assert(await contentOpacity(page) === '0', `FAIL: [${theme}] at rest the icon and label are hidden, not clipped`);
        const middle = (rest.top + rest.bottom) / 2;
        assert(Math.abs(middle - VIEWPORT.height / 2) <= 2, `FAIL: [${theme}] the tab is vertically centred (middle ${middle})`);
        await page.screenshot({ path: join(TMP, `sidebar-tab-rest-${theme}.png`) });

        let reachedTab = false;
        let enteredPanel = false;
        for (let presses = 0; presses < 60 && !reachedTab && !enteredPanel; presses++) {
          await page.keyboard.press('Tab');
          enteredPanel = await page.evaluate(() => document.activeElement?.closest('.dict-nav-panel') != null);
          reachedTab = await focusedLabel(page) === 'Open sidebar';
        }
        assert(!enteredPanel, `FAIL: [${theme}] Tab never reaches the closed sidebar's links`);
        assert(reachedTab, `FAIL: [${theme}] the tab is reachable with the Tab key`);
        await settle(page);
        const focused = await tabBox(page);
        assert(
          Math.abs(focused.right - VIEWPORT.width) <= 0.5,
          `FAIL: [${theme}] keyboard focus brings the tab fully on-screen (right ${focused.right})`,
        );
        assert(await contentOpacity(page) === '1', `FAIL: [${theme}] keyboard focus shows the icon and label`);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });

        // 14px left of the lip: inside the tab's wider hover target, outside the tab itself.
        await page.mouse.move(VIEWPORT.width - lip - 14, middle);
        await settle(page);
        const hovered = await tabBox(page);
        assert(
          hovered.right <= VIEWPORT.width + 0.5 && hovered.right >= VIEWPORT.width - 2,
          `FAIL: [${theme}] hover brings the tab fully on-screen (right ${hovered.right})`,
        );
        assert(await contentOpacity(page) === '1', `FAIL: [${theme}] hover shows the icon and label`);
        await page.screenshot({ path: join(TMP, `sidebar-tab-hover-${theme}.png`) });

        await tab.click();
        await page.waitForSelector(TAB, { state: 'detached', timeout: 5_000 });
        await settle(page);
        assert(await panelOnScreen(page), `FAIL: [${theme}] clicking the tab opens the sidebar`);
        assert(await focusedLabel(page) === 'Close sidebar', `FAIL: [${theme}] opening from the tab focuses the close button`);
        const stored = await page.evaluate(() => localStorage.getItem('ignatius-dict-nav-open'));
        assert(stored === 'true', `FAIL: [${theme}] the open state is written to ignatius-dict-nav-open (got ${stored})`);
        await page.mouse.move(10, 10);
        await page.screenshot({ path: join(TMP, `sidebar-tab-open-${theme}.png`) });

        await page.reload();
        await page.waitForSelector('.dict-view', { timeout: 15_000 });
        await settle(page);
        assert(await panelOnScreen(page), `FAIL: [${theme}] after a reload the sidebar is still open`);
        assert(await page.locator(TAB).count() === 0, `FAIL: [${theme}] after a reload the open sidebar hides the tab`);
        assert(await focusedLabel(page) !== 'Close sidebar', `FAIL: [${theme}] a reload with the sidebar open leaves focus alone`);

        await page.getByRole('button', { name: 'Close sidebar' }).click();
        await tab.waitFor({ state: 'visible', timeout: 5_000 });
        await settle(page);
        assert(await focusedLabel(page) === 'Open sidebar', `FAIL: [${theme}] closing from the close button focuses the tab`);
        assert(!(await panelOnScreen(page)), `FAIL: [${theme}] the close button closes the sidebar`);
        const cleared = await page.evaluate(() => localStorage.getItem('ignatius-dict-nav-open'));
        assert(cleared === null, `FAIL: [${theme}] closing removes ignatius-dict-nav-open (got ${cleared})`);

        await page.click('.fab');
        await page.getByRole('menuitem', { name: 'Toggle sidebar' }).click();
        await page.waitForSelector(TAB, { state: 'detached', timeout: 5_000 });
        await settle(page);
        assert(await panelOnScreen(page), `FAIL: [${theme}] FAB "Toggle sidebar" still opens the sidebar`);
        assert(await focusedLabel(page) !== 'Close sidebar', `FAIL: [${theme}] the FAB toggle leaves focus alone`);
        await page.getByRole('button', { name: 'Close sidebar' }).click();
        await tab.waitFor({ state: 'visible', timeout: 5_000 });

        await page.goto(`${BASE}/#view=graph`);
        await page.waitForTimeout(500);
        assert(!(await page.locator(TAB).isVisible()), `FAIL: [${theme}] the tab is not shown in the Graph view`);

        await page.goto(`${BASE}/#view=dict`);
        await tab.waitFor({ state: 'visible', timeout: 5_000 });
        await page.setViewportSize({ width: 700, height: 900 });
        await settle(page);
        assert(!(await tab.isVisible()), `FAIL: [${theme}] the tab is hidden at max-width 768px`);
        await page.setViewportSize(VIEWPORT);
        await page.emulateMedia({ media: 'print' });
        assert(!(await tab.isVisible()), `FAIL: [${theme}] the tab is hidden in print`);
        await page.emulateMedia({ media: 'screen' });

        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reduced = await tab.evaluate(el => getComputedStyle(el).transitionDuration);
        assert(reduced.split(',').every(d => parseFloat(d) === 0), `FAIL: [${theme}] reduced motion disables the transition (got ${reduced})`);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const normal = await tab.evaluate(el => getComputedStyle(el).transitionDuration);
        const longest = Math.max(...normal.split(',').map(d => parseFloat(d)));
        assert(longest > 0 && longest < 0.2, `FAIL: [${theme}] the transition is under 200ms (got ${normal})`);

        assert(pageErrors.length === 0, `FAIL: [${theme}] no page errors (got ${pageErrors.join(' | ')})`);
      } finally {
        await ctx.close();
      }
    }
    for (const theme of ['dark', 'light']) {
      for (const state of ['rest', 'hover', 'open']) console.log(`Saved ${join(TMP, `sidebar-tab-${state}-${theme}.png`)}`);
    }
    console.log(process.exitCode ? '\nsidebar-tab: failures above.' : '\nAll sidebar-tab checks passed.');
  } finally {
    await browser.close();
  }
} finally {
  handle.stop(true);
  clearTimeout(watchdog);
}
