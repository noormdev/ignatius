/**
 * Side-nav smoke tests for the generated data dictionary.
 *
 * The standalone hamburger toggle (#dict-nav-toggle) was retired — it is kept in
 * the DOM hidden as the state anchor, and the sidebar is now driven by the FAB
 * menu's "Toggle sidebar" item. The sidebar also no longer auto-closes on an
 * outside click or a nav-link click; only the FAB item or Escape closes it.
 *
 * Opens the dict HTML at desktop and mobile viewports via Playwright and verifies:
 *   1. The retired toggle button is hidden (display: none) at desktop and mobile
 *   2. FAB "Toggle sidebar" opens the panel (aria-hidden=false)
 *   3. FAB "Toggle sidebar" again closes it
 *   4. Escape closes the panel
 *   5. localStorage reflects open/closed state
 *   6. Reload preserves open state
 *   7. Scrollspy: scrolling to a section marks its nav link is-current
 *   8. Clicking a nav link marks it is-current
 *
 * Screenshot saved to tmp/dict-side-nav-desktop.png.
 */
import { parseModels } from '../../src/parse';
import { generateDict } from '../../src/generators/dict';
import { chromium, type Page } from 'playwright';
import { resolve } from 'node:path';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failures++;
    } else {
        console.log(`PASS: ${msg}`);
    }
}

async function isPanelOpen(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const panel = document.getElementById('dict-nav-panel');
        return panel ? panel.getAttribute('aria-hidden') === 'false' : false;
    });
}

// Drive the sidebar the way a user does: open the FAB menu, click "Toggle sidebar".
// The FAB button toggles the menu, so only click it open when it is currently
// closed — otherwise we would close an already-open menu and the item would
// never become visible.
async function fabToggleSidebar(page: Page): Promise<void> {
    const menuOpen = await page.evaluate(
        () => !!document.getElementById('dict-fab-menu')?.classList.contains('dict-fab-menu--open'),
    );
    if (!menuOpen) await page.click('#dict-fab');
    await page.waitForSelector('.dict-fab-menu-item[data-action="toggle-sidebar"]', { state: 'visible' });
    await page.click('.dict-fab-menu-item[data-action="toggle-sidebar"]');
    await page.waitForTimeout(80);
}

async function setSidebar(page: Page, wantOpen: boolean): Promise<void> {
    if ((await isPanelOpen(page)) !== wantOpen) await fabToggleSidebar(page);
}

const { model, globalErrors: parseGlobalErrors } = await parseModels('models/key-inherited');
const dictHtml = await generateDict(model, { globalErrors: parseGlobalErrors, entityErrors: [] }, 'dark', { modelsDir: 'models/key-inherited' });

const fixturePath = resolve('tmp/dict-side-nav-fixture.html');
await Bun.write(fixturePath, dictHtml);

const browser = await chromium.launch();

// ── Desktop: 1280×800 ─────────────────────────────────────────────────────────
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`file://${fixturePath}`);
await page.waitForLoadState('domcontentloaded');

// localStorage on file:// can leak the persisted sidebar state across runs,
// which would make the open/close assertions order-dependent. Reset to a known
// closed baseline before the interaction tests.
await page.evaluate(() => { try { localStorage.removeItem('ignatius-dict-nav'); } catch (_) {} });
await page.reload();
await page.waitForLoadState('domcontentloaded');

// 1. Retired toggle is hidden at desktop (superseded by the FAB menu item).
const toggleHiddenDesktop = await page.evaluate(() => {
    const el = document.getElementById('dict-nav-toggle');
    if (!el) return false;
    return window.getComputedStyle(el).display === 'none';
});
assert(toggleHiddenDesktop, 'desktop: retired toggle button is hidden (display:none)');

// ...and hidden at mobile too.
await page.setViewportSize({ width: 375, height: 667 });
const toggleHiddenMobile = await page.evaluate(() => {
    const el = document.getElementById('dict-nav-toggle');
    if (!el) return false;
    return window.getComputedStyle(el).display === 'none';
});
assert(toggleHiddenMobile, 'mobile (375px): retired toggle button is hidden (display:none)');
await page.setViewportSize({ width: 1280, height: 800 });

// 2. FAB "Toggle sidebar" opens the panel.
await fabToggleSidebar(page);
assert(await isPanelOpen(page), 'FAB "Toggle sidebar": panel opens (aria-hidden=false)');

// 3. FAB "Toggle sidebar" again closes it (no outside-click auto-close anymore).
await fabToggleSidebar(page);
assert(!(await isPanelOpen(page)), 'FAB "Toggle sidebar" again: panel closes (aria-hidden=true)');

// 4. Escape closes the panel.
await setSidebar(page, true);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
assert(!(await isPanelOpen(page)), 'Escape key: panel closes (aria-hidden=true)');

// 5. localStorage reflects open/closed state.
await setSidebar(page, true);
await page.waitForTimeout(100);
const lsOpen = await page.evaluate(() => {
    try { return localStorage.getItem('ignatius-dict-nav'); } catch (_) { return null; }
});
assert(lsOpen === 'open', `localStorage 'ignatius-dict-nav' = 'open' when sidebar open (got: ${lsOpen})`);

await setSidebar(page, false);
await page.waitForTimeout(100);
const lsClosed = await page.evaluate(() => {
    try { return localStorage.getItem('ignatius-dict-nav'); } catch (_) { return null; }
});
assert(lsClosed === 'closed', `localStorage 'ignatius-dict-nav' = 'closed' when sidebar closed (got: ${lsClosed})`);

// 6. Reload preserves open state.
await setSidebar(page, true);
await page.waitForTimeout(100);
await page.reload();
await page.waitForLoadState('domcontentloaded');
assert(await isPanelOpen(page), 'reload with localStorage=open: panel is restored open');

// 7. Scrollspy: scroll to the second entity-section → its nav link gains is-current.
await setSidebar(page, true);
await page.waitForTimeout(100);
const targetId = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.entity-section'));
    if (sections.length < 2) return null;
    const target = sections[1] as HTMLElement;
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    return target.id;
});
assert(targetId !== null, 'scrollspy: at least 2 entity sections exist');
if (targetId !== null) {
    await page.waitForFunction(
        (expectedHref) => {
            const link = document.querySelector('.dict-nav-link.is-current');
            return link !== null && link.getAttribute('href') === expectedHref;
        },
        '#' + targetId,
        { timeout: 3000 },
    );
    const currentHref = await page.evaluate(() => {
        const link = document.querySelector('.dict-nav-link.is-current');
        return link ? link.getAttribute('href') : null;
    });
    assert(
        currentHref === '#' + targetId,
        `scrollspy: second entity nav link gains is-current (href=#${targetId}, got: ${currentHref})`,
    );
}

// 8. Clicking a different nav link → that entry becomes is-current.
const clickTarget = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('.dict-nav-link')) as HTMLAnchorElement[];
    if (links.length < 3) return null;
    return links[2].getAttribute('href');
});
assert(clickTarget !== null, 'scrollspy: at least 3 nav links exist');
if (clickTarget !== null) {
    await page.evaluate((href) => {
        const links = Array.from(document.querySelectorAll('.dict-nav-link')) as HTMLAnchorElement[];
        const link = links.find(l => l.getAttribute('href') === href);
        if (link) link.click();
    }, clickTarget);
    await page.waitForFunction(
        (expectedHref) => {
            const link = document.querySelector('.dict-nav-link.is-current');
            return link !== null && link.getAttribute('href') === expectedHref;
        },
        clickTarget,
        { timeout: 3000 },
    );
    const currentHref = await page.evaluate(() => {
        const link = document.querySelector('.dict-nav-link.is-current');
        return link ? link.getAttribute('href') : null;
    });
    assert(
        currentHref === clickTarget,
        `scrollspy: clicking nav link makes it is-current (expected: ${clickTarget}, got: ${currentHref})`,
    );
}

await page.screenshot({ path: resolve('tmp/dict-side-nav-desktop.png') });
console.log('Screenshot saved: tmp/dict-side-nav-desktop.png');

await page.close();
await browser.close();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
