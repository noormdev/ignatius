/**
 * Side-nav smoke tests for the generated data dictionary.
 *
 * Opens the dict HTML at desktop and mobile viewports via Playwright and verifies:
 *   1. Toggle button visible at 1280×800 desktop
 *   2. Toggle button hidden (display: none) at 375×667 mobile
 *   3. Clicking toggle opens the panel (aria-hidden=false)
 *   4. Clicking outside the panel closes it
 *   5. Pressing Escape closes the panel
 *   6. localStorage reflects open/closed state correctly
 *   7. Reload preserves open state (visual + localStorage)
 *
 * Screenshots saved to tmp/dict-side-nav-desktop.png.
 */
import { parseModels } from '../../src/parse';
import { generateDict } from '../../src/generators/dict';
import { chromium } from 'playwright';
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

// 1. Toggle button visible at desktop
const toggleVisible = await page.evaluate(() => {
    const el = document.getElementById('dict-nav-toggle');
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
});
assert(toggleVisible, 'desktop: toggle button is visible');

// 2. Toggle button hidden at mobile
await page.setViewportSize({ width: 375, height: 667 });
const toggleHidden = await page.evaluate(() => {
    const el = document.getElementById('dict-nav-toggle');
    if (!el) return false;
    return window.getComputedStyle(el).display === 'none';
});
assert(toggleHidden, 'mobile (375px): toggle button is hidden (display:none)');

// Reset to desktop for interaction tests
await page.setViewportSize({ width: 1280, height: 800 });

// 3. Clicking toggle opens the panel
await page.click('#dict-nav-toggle');
const panelOpen = await page.evaluate(() => {
    const panel = document.getElementById('dict-nav-panel');
    if (!panel) return false;
    return panel.getAttribute('aria-hidden') === 'false';
});
assert(panelOpen, 'clicking toggle: panel opens (aria-hidden=false)');

// 4. Clicking outside the panel closes it
await page.mouse.click(100, 400); // far left, outside panel and toggle
await page.waitForTimeout(100);
const panelClosedByOutsideClick = await page.evaluate(() => {
    const panel = document.getElementById('dict-nav-panel');
    if (!panel) return false;
    return panel.getAttribute('aria-hidden') === 'true';
});
assert(panelClosedByOutsideClick, 'clicking outside: panel closes (aria-hidden=true)');

// 5. Escape closes the panel — first re-open it
await page.click('#dict-nav-toggle');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
const panelClosedByEsc = await page.evaluate(() => {
    const panel = document.getElementById('dict-nav-panel');
    if (!panel) return false;
    return panel.getAttribute('aria-hidden') === 'true';
});
assert(panelClosedByEsc, 'Escape key: panel closes (aria-hidden=true)');

// 6. localStorage reflects state: open the panel → check 'open'; close → check 'closed'
await page.click('#dict-nav-toggle'); // open
await page.waitForTimeout(100);
const lsOpen = await page.evaluate(() => {
    try { return localStorage.getItem('ignatius-dict-nav'); } catch (_) { return null; }
});
assert(lsOpen === 'open', `localStorage 'ignatius-dict-nav' = 'open' after toggle open (got: ${lsOpen})`);

await page.click('#dict-nav-toggle'); // close
await page.waitForTimeout(100);
const lsClosed = await page.evaluate(() => {
    try { return localStorage.getItem('ignatius-dict-nav'); } catch (_) { return null; }
});
assert(lsClosed === 'closed', `localStorage 'ignatius-dict-nav' = 'closed' after toggle close (got: ${lsClosed})`);

// 7. Reload preserves open state
// Open the panel, verify it persists after reload
await page.click('#dict-nav-toggle'); // open
await page.waitForTimeout(100);
await page.reload();
await page.waitForLoadState('domcontentloaded');
const restoredOpen = await page.evaluate(() => {
    const panel = document.getElementById('dict-nav-panel');
    if (!panel) return false;
    return panel.getAttribute('aria-hidden') === 'false';
});
assert(restoredOpen, 'reload with localStorage=open: panel is restored open');

// 8. Scrollspy: scroll to second entity-section → its nav link gains is-current
// Re-open the panel to make scrollIntoView in the observer work correctly.
await page.click('#dict-nav-toggle'); // ensure open
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

// 9. Click a different nav link → that entry becomes is-current
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

// 10. Inside-panel click guard: clicking a non-link element inside the panel
//     does NOT close it via the outside-click handler.
await page.click('#dict-nav-toggle'); // ensure open
await page.waitForTimeout(100);
const groupTitle = await page.$('.dict-nav-group-label');
assert(groupTitle !== null, 'inside-panel guard: .dict-nav-group-label element exists');
if (groupTitle !== null) {
    await groupTitle.click();
    await page.waitForTimeout(100);
    const stillOpen = await page.evaluate(() => {
        const panel = document.getElementById('dict-nav-panel');
        return panel ? panel.getAttribute('aria-hidden') === 'false' : false;
    });
    assert(stillOpen, 'inside-panel guard: clicking group title (non-link) inside panel does not close it');
}

await page.screenshot({ path: resolve('tmp/dict-side-nav-desktop.png') });
console.log('Screenshot saved: tmp/dict-side-nav-desktop.png');

await page.close();
await browser.close();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
