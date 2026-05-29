/**
 * Print-emulation verification for the generated data dictionary HTML.
 *
 * Uses page.emulateMedia({ media: 'print' }) to verify:
 *   1. .dict-branding does NOT have position: fixed in print media
 *      (either position: static or display: none)
 *   2. .dict-footer does NOT have position: fixed in print media
 *      (either position: static or display: none)
 *   3. Copyright text is present in the rendered DOM (visible or via a
 *      print-only alternative element)
 *   4. At least one .entity-section has computed break-inside: avoid
 *
 * Design call — link URLs: `a::after { content: " (" attr(href) ")" }` in print
 * so URLs are visible without cluttering the screen view. The `Noorm` link and
 * any entity FK links will print their href inline.
 *
 * Design call — background colors: `print-color-adjust: exact` on group-header,
 * entity-section, .badge, and .swatch so group color bands and key markers
 * survive print without needing fallback borders.
 *
 * Screenshot saved to tmp/dict-print.png.
 */
import { parseModels } from '../src/parse';
import { generateDict } from '../src/generators/dict';
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

const model = await parseModels('models');
const dictHtml = await generateDict(model, 'dark', { modelsDir: 'models' });

const fixturePath = resolve('tmp/dict-print-fixture.html');
await Bun.write(fixturePath, dictHtml);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`file://${fixturePath}`);
await page.waitForLoadState('domcontentloaded');

// Switch to print media
await page.emulateMedia({ media: 'print' });

// 1. .dict-branding is not fixed in print
const brandingPos = await page.evaluate(() => {
    const el = document.querySelector('.dict-branding');
    if (!el) return 'MISSING';
    return window.getComputedStyle(el).position;
});
const brandingDisplay = await page.evaluate(() => {
    const el = document.querySelector('.dict-branding');
    if (!el) return 'MISSING';
    return window.getComputedStyle(el).display;
});
assert(
    brandingPos !== 'fixed' || brandingDisplay === 'none',
    `.dict-branding: not fixed in print (position=${brandingPos}, display=${brandingDisplay})`,
);

// 2. .dict-footer is not fixed in print
const footerPos = await page.evaluate(() => {
    const el = document.querySelector('.dict-footer');
    if (!el) return 'MISSING';
    return window.getComputedStyle(el).position;
});
const footerDisplay = await page.evaluate(() => {
    const el = document.querySelector('.dict-footer');
    if (!el) return 'MISSING';
    return window.getComputedStyle(el).display;
});
assert(
    footerPos !== 'fixed' || footerDisplay === 'none',
    `.dict-footer: not fixed in print (position=${footerPos}, display=${footerDisplay})`,
);

// 3. Copyright text is present and visible in the DOM
// Either .dict-footer-copyright is visible, or a .print-copyright element exists
const copyrightVisible = await page.evaluate(() => {
    // Check if footer copyright element itself is visible
    const inFooter = document.querySelector('.dict-footer-copyright');
    if (inFooter) {
        const style = window.getComputedStyle(inFooter);
        if (style.display !== 'none' && style.visibility !== 'hidden') return true;
    }
    // Check for a dedicated print-only copyright element
    const printEl = document.querySelector('.print-copyright');
    if (printEl) {
        const style = window.getComputedStyle(printEl);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }
    return false;
});
assert(copyrightVisible, 'copyright text is visible in print DOM');

// 4. At least one .entity-section has break-inside: avoid
const breakInsideAvoid = await page.evaluate(() => {
    const sections = document.querySelectorAll('.entity-section');
    for (const s of sections) {
        if (window.getComputedStyle(s).breakInside === 'avoid') return true;
    }
    return false;
});
assert(breakInsideAvoid, 'at least one .entity-section has break-inside: avoid');

// 5. Print mode always uses light CSS variables regardless of generation mode.
//    When generated with mode='dark', --color-background at :root is a dark hex.
//    The @media print :root override must reset it to the light palette value (#ffffff).
const printBgVar = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim();
});
assert(
    printBgVar === '#ffffff',
    `@media print :root --color-background resolves to light value (#ffffff), got: ${printBgVar}`,
);

await page.screenshot({ path: resolve('tmp/dict-print.png'), fullPage: true });
console.log('Screenshot saved: tmp/dict-print.png');

await browser.close();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
