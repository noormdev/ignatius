/**
 * Mobile-responsive verification for the generated data dictionary HTML.
 *
 * Opens the generated dict at 375×667 (iPhone SE viewport) and verifies:
 *   1. No horizontal scroll on <html> / <body>
 *   2. First entity heading is not occluded (boundingBox().y >= 0)
 *   3. Page does not overflow horizontally at the body level
 *
 * Also smoke-tests desktop at 1280×800 to confirm the desktop layout is
 * visually unchanged (no horizontal scroll).
 *
 * Screenshots saved to tmp/dict-mobile.png and tmp/dict-desktop.png.
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

const fixturePath = resolve('tmp/dict-mobile-fixture.html');
await Bun.write(fixturePath, dictHtml);

const browser = await chromium.launch();

// ── Mobile: 375×667 ───────────────────────────────────────────────────────────

const mobilePage = await browser.newPage();
await mobilePage.setViewportSize({ width: 375, height: 667 });
await mobilePage.goto(`file://${fixturePath}`);
await mobilePage.waitForLoadState('domcontentloaded');

// 1. No horizontal scroll on <html>
const scrollWidth = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth,
);
const innerWidth = await mobilePage.evaluate(() => window.innerWidth);
assert(
    scrollWidth <= innerWidth + 1,
    `mobile: no horizontal scroll on <html> (scrollWidth=${scrollWidth}, innerWidth=${innerWidth})`,
);

// 2. Body does not overflow horizontally
const bodyScrollWidth = await mobilePage.evaluate(() => document.body.scrollWidth);
assert(
    bodyScrollWidth <= innerWidth + 1,
    `mobile: body does not overflow horizontally (bodyScrollWidth=${bodyScrollWidth}, innerWidth=${innerWidth})`,
);

// 3. First entity heading is not occluded by the fixed branding block.
//    We probe the element at the center of the h2's bounding rect.
//    The topmost element must be the h2 itself or a descendant of it —
//    not a .dict-branding descendant (which would indicate occlusion).
const occlusionResult = await mobilePage.evaluate(() => {
    const h2 = document.querySelector('h2');
    if (!h2) return { ok: false, reason: 'no h2 found' };
    const rect = h2.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return { ok: false, reason: 'elementFromPoint returned null' };
    const inH2 = h2.contains(topEl) || topEl === h2;
    const inBranding = !!topEl.closest('.dict-branding');
    if (inBranding) return { ok: false, reason: `.dict-branding occludes the h2 at (${cx.toFixed(0)},${cy.toFixed(0)})` };
    if (!inH2) return { ok: false, reason: `unexpected element occludes h2: ${topEl.tagName}.${[...topEl.classList].join('.')}` };
    return { ok: true, reason: 'h2 center is unoccluded' };
});
assert(occlusionResult.ok, `mobile: first entity h2 not occluded by .dict-branding (${occlusionResult.reason})`);

await mobilePage.screenshot({ path: resolve('tmp/dict-mobile.png') });
console.log('Screenshot saved: tmp/dict-mobile.png');
await mobilePage.close();

// ── Desktop: 1280×800 ─────────────────────────────────────────────────────────

const desktopPage = await browser.newPage();
await desktopPage.setViewportSize({ width: 1280, height: 800 });
await desktopPage.goto(`file://${fixturePath}`);
await desktopPage.waitForLoadState('domcontentloaded');

const desktopScrollWidth = await desktopPage.evaluate(
    () => document.documentElement.scrollWidth,
);
const desktopInnerWidth = await desktopPage.evaluate(() => window.innerWidth);
assert(
    desktopScrollWidth <= desktopInnerWidth + 1,
    `desktop: no horizontal scroll (scrollWidth=${desktopScrollWidth}, innerWidth=${desktopInnerWidth})`,
);

await desktopPage.screenshot({ path: resolve('tmp/dict-desktop.png') });
console.log('Screenshot saved: tmp/dict-desktop.png');
await desktopPage.close();

await browser.close();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
