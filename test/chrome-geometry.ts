import type { Page } from 'playwright';

/** A subtitle at the parser's 50-character cap: the widest branding block. */
export const LONG_SUBTITLE = 'Order-to-cash reference model for noorm.dev guides';

export type Box = { left: number; right: number; top: number; bottom: number };

/** True when the two boxes cover each other on both axes. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The viewport box of the first element matching `selector`, or null. */
export async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
  }, selector);
}

/** Resizes, then waits until the CSS sees the width and `--branding-gutter` matches the
 *  branding block: the top-row bars read both, so measuring sooner sees the old layout. */
export async function settleAt(page: Page, width: number, height = 800): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((w) => {
    const brand = document.querySelector('.branding-block')?.getBoundingClientRect().width ?? 0;
    const gutter = getComputedStyle(document.documentElement).getPropertyValue('--branding-gutter').trim();
    return window.innerWidth === w && gutter === `${Math.ceil(brand)}px`;
  }, width, { timeout: 5000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** True when the element at the centre of `selector` is that element or inside it. */
export async function onTop(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    if (!el || !r) return false;
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }, selector);
}
