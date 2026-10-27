/** test-modal-focus-trap.ts — keyboard focus stays inside the topmost modal and returns to its opener on close. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const PORT = 3336;
const BASE = `http://localhost:${PORT}`;

const WATCHDOG_MS = 60_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-modal-focus-trap.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

function focusState(page: Page, modalSelector: string) {
  return page.evaluate((sel) => {
    const modals = document.querySelectorAll(sel);
    const modal = modals[modals.length - 1];
    const active = document.activeElement;
    function stampStop(el: Element | null): string {
      if (!el) return '';
      let id = el.getAttribute('data-stop');
      if (!id) {
        id = String(document.querySelectorAll('[data-stop]').length);
        el.setAttribute('data-stop', id);
      }
      return id;
    }
    return {
      inside: !!modal && !!active && modal.contains(active),
      isClose: !!active && active.classList.contains('modal-close') && !!modal?.contains(active),
      desc: active ? `${active.tagName.toLowerCase()}.${active.className}` : 'none',
      stop: stampStop(active),
    };
  }, modalSelector);
}

/** Returns the last stop before Tab wraps back to the close button. */
async function tabCycle(page: Page, modalSelector: string, label: string): Promise<string> {
  let last = '';
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    const s = await focusState(page, modalSelector);
    assert(s.inside, `FAIL: ${label}: Tab #${i + 1} left the modal (focused ${s.desc})`);
    if (!s.inside) return last;
    if (s.isClose) {
      assert(i > 0, `FAIL: ${label}: fixture: modal has more than one focusable element`);
      return last;
    }
    last = s.stop;
  }
  assert(false, `FAIL: ${label}: Tab never wrapped back to the close button`);
  return last;
}

async function focusOutside(page: Page) {
  await page.evaluate(() => {
    let probe = document.getElementById('outside-probe');
    if (!probe) {
      probe = document.createElement('button');
      probe.id = 'outside-probe';
      probe.textContent = 'outside';
      document.body.appendChild(probe);
    }
    probe.focus();
  });
}

/** Logs focusin outside the topmost `.modal`, which the trap's pull-back hides from activeElement. */
async function watchEscapes(page: Page) {
  await page.evaluate(() => {
    window.addEventListener('focusin', (e) => {
      const modals = document.querySelectorAll('.modal');
      const top = modals[modals.length - 1];
      if (!top || !(e.target instanceof Element) || top.contains(e.target)) return;
      const log = document.documentElement;
      log.dataset.focusEscapes = `${log.dataset.focusEscapes ?? ''}${e.target.tagName.toLowerCase()}#${e.target.id};`;
    }, true);
  });
}

function takeEscapes(page: Page) {
  return page.evaluate(() => {
    const log = document.documentElement;
    const escapes = log.dataset.focusEscapes ?? '';
    delete log.dataset.focusEscapes;
    return escapes;
  });
}

const handle = serveCommand(MODEL, { port: PORT });
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/#entity=PaymentMethod`);
  await page.waitForSelector('.modal .json-value-expand', { timeout: 15_000 });

  const aria = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const id = modal?.getAttribute('aria-labelledby') ?? '';
    const h1 = modal?.querySelector('.modal-header h1');
    return {
      role: modal?.getAttribute('role'),
      ariaModal: modal?.getAttribute('aria-modal'),
      labelled: !!id && !!h1 && h1.id === id && document.getElementById(id) === h1,
    };
  });
  assert(aria.role === 'dialog', `FAIL: modal has role="dialog" (got ${aria.role})`);
  assert(aria.ariaModal === 'true', `FAIL: modal has aria-modal="true" (got ${aria.ariaModal})`);
  assert(aria.labelled, 'FAIL: modal aria-labelledby names its <h1>');

  const start = await focusState(page, '.modal');
  assert(start.isClose, `FAIL: the close button is focused on open (focused ${start.desc})`);

  await watchEscapes(page);
  const lastStop = await tabCycle(page, '.modal', 'entity modal');
  const cycleEscapes = await takeEscapes(page);
  assert(cycleEscapes === '', `FAIL: entity modal: Tab from the last element wraps without focus leaving the modal (escaped to ${cycleEscapes})`);
  await page.keyboard.press('Shift+Tab');
  const back = await focusState(page, '.modal');
  assert(back.inside && back.stop === lastStop, `FAIL: Shift+Tab from the first element wraps to the last (expected stop ${lastStop}, focused stop ${back.stop} ${back.desc})`);
  const shiftEscapes = await takeEscapes(page);
  assert(shiftEscapes === '', `FAIL: Shift+Tab from the first element wraps without focus leaving the modal (escaped to ${shiftEscapes})`);

  await focusOutside(page);
  await takeEscapes(page);
  const pulled = await focusState(page, '.modal');
  assert(pulled.isClose, `FAIL: focus moved outside the modal is pulled back to the first element (focused ${pulled.desc})`);

  // A blur keeps Chrome's Tab start point inside the modal; park focus before the
  // app instead, hiding that one focusin from the trap's pull-back.
  const parked = await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.id = 'leading-probe';
    document.body.prepend(probe);
    window.addEventListener('focusin', e => e.stopPropagation(), { capture: true, once: true });
    probe.focus();
    return document.activeElement === probe;
  });
  assert(parked, 'FAIL: fixture: focus parks on a button before the app');
  await takeEscapes(page);
  await page.keyboard.press('Tab');
  const fromOutside = await focusState(page, '.modal');
  assert(fromOutside.isClose, `FAIL: Tab with focus outside the modal moves to its first element (focused ${fromOutside.desc})`);
  const outsideEscapes = await takeEscapes(page);
  assert(outsideEscapes === '', `FAIL: Tab with focus outside the modal goes straight into it (escaped to ${outsideEscapes})`);

  // Stacked JSON dialog over the entity modal: it traps, the entity modal stays passive.
  const opener = page.locator('.modal .json-value-expand').first();
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal-json', { timeout: 5_000 });
  const stackedStart = await focusState(page, '.modal-json');
  assert(stackedStart.isClose, `FAIL: the stacked dialog focuses its close button (focused ${stackedStart.desc})`);
  await takeEscapes(page);
  await tabCycle(page, '.modal-json', 'stacked JSON dialog');
  const stackedEscapes = await takeEscapes(page);
  assert(stackedEscapes === '', `FAIL: stacked JSON dialog: Tab wraps without focus leaving it (escaped to ${stackedEscapes})`);

  await focusOutside(page);
  const stackedPulled = await focusState(page, '.modal-json');
  assert(stackedPulled.isClose, `FAIL: escaped focus returns to the stacked dialog, not its opener (focused ${stackedPulled.desc})`);

  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-json', { state: 'detached', timeout: 5_000 });
  const restored = await page.evaluate(() => {
    const opener = document.querySelector('.modal .json-value-expand');
    return document.activeElement === opener;
  });
  assert(restored, 'FAIL: closing the stacked dialog returns focus to the button that opened it');

  // Dictionary page: closing the only modal returns focus to its opener outside any modal.
  const dict = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await dict.goto(`${BASE}/#view=dict`);
  await dict.waitForSelector('.json-value-expand', { timeout: 15_000 });
  await dict.evaluate(() => document.querySelector('.json-value-expand')?.setAttribute('data-probe', 'opener'));
  await dict.locator('[data-probe="opener"]').focus();
  await dict.keyboard.press('Enter');
  await dict.waitForSelector('.modal-json', { timeout: 5_000 });
  await dict.keyboard.press('Escape');
  await dict.waitForSelector('.modal-json', { state: 'detached', timeout: 5_000 });
  const dictRestored = await dict.evaluate(() => document.activeElement?.getAttribute('data-probe') === 'opener');
  assert(dictRestored, 'FAIL: closing a dictionary JSON dialog returns focus to its expand button');

  await dict.locator('.fab').focus();
  await dict.keyboard.press('Enter');
  await dict.getByRole('menuitem', { name: 'Settings' }).focus();
  await dict.keyboard.press('Enter');
  await dict.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5_000 });
  await dict.keyboard.press('Escape');
  await dict.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5_000 });
  const fabRestored = await dict.evaluate(() => document.activeElement?.classList.contains('fab') ?? false);
  assert(fabRestored, 'FAIL: closing Settings opened from the FAB menu returns focus to the FAB');

  console.log(process.exitCode ? '\nmodal-focus-trap: failures above.' : '\nAll modal-focus-trap checks passed.');
} finally {
  await browser.close();
  handle.stop(true);
  clearTimeout(watchdog);
}
