/** test-scroll-memory.ts — the Dictionary and its sidebar keep their scroll position across a model reload, a view switch and a page reload. */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');
const PORT = 7476;
const BASE = `http://localhost:${PORT}`;
const TARGET = 2000;
const TOLERANCE = 4;

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-scroll-memory.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

const VIEW = '.dict-view';
const NAV = '.dict-nav-panel';

function scrollTopOf(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => el.scrollTop);
}

async function scrollTo(page: Page, selector: string, top: number) {
  await page.locator(selector).evaluate((el, y) => { el.scrollTop = y; }, top);
  await page.waitForTimeout(300);
}

async function waitForScrollToStop(page: Page, selector: string) {
  let previous = Number.NaN;
  for (let polls = 0; polls < 40; polls++) {
    await page.waitForTimeout(250);
    const current = await scrollTopOf(page, selector);
    if (current === previous) return;
    previous = current;
  }
}

function assertNear(actual: number, expected: number, label: string) {
  const ok = Math.abs(actual - expected) <= TOLERANCE;
  assert(ok, `FAIL: ${label} (scrollTop ${actual}, want ${expected})`);
  if (ok) console.log(`  PASS  ${label}`);
}

const root = mkdtempSync(join(tmpdir(), 'ignatius-scroll-memory-'));
const dir = join(root, 'model');
// Other checks serve models/key-inherited in place and leave .ignatius/ behind.
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });
// The no-diagram check needs a model without mermaid fences, and the demo model carries one.
for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
  if (!file.endsWith('.md')) continue;
  const path = join(dir, file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/```mermaid\n[\s\S]*?```\n?/g, ''));
}
const handle = serveCommand(dir, { port: PORT });

try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    const mermaidRequests: string[] = [];
    page.on('request', r => { if (r.url().endsWith('/static/mermaid.js')) mermaidRequests.push(r.url()); });

    await page.goto(`${BASE}/#view=dict`);
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await waitForScrollToStop(page, VIEW);
    await scrollTo(page, VIEW, TARGET);
    assert(await scrollTopOf(page, VIEW) === TARGET, `FAIL: the Dictionary can scroll to ${TARGET}px`);

    const marker = 'scroll-memory-touch-marker';
    appendFileSync(join(dir, 'data/transactional/Payment.md'), `\n${marker}\n`);
    await page.locator(VIEW).getByText(marker).waitFor({ timeout: 15_000 });
    await waitForScrollToStop(page, VIEW);
    assertNear(await scrollTopOf(page, VIEW), TARGET, '(a) a model reload keeps the Dictionary scroll');

    await scrollTo(page, VIEW, TARGET);
    await page.click('.fab');
    await page.getByRole('menuitem', { name: /Data Graph/ }).click();
    await page.waitForFunction(() => location.hash.includes('view=graph'));
    await page.click('.fab');
    await page.getByRole('menuitem', { name: /Dictionary/ }).click();
    await page.locator(VIEW).waitFor({ state: 'visible' });
    await waitForScrollToStop(page, VIEW);
    assertNear(await scrollTopOf(page, VIEW), TARGET, '(b) Graph and back keeps the Dictionary scroll');

    await scrollTo(page, VIEW, TARGET);
    await page.reload();
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await waitForScrollToStop(page, VIEW);
    assertNear(await scrollTopOf(page, VIEW), TARGET, '(c) a page reload keeps the Dictionary scroll');

    const bottom = await page.locator(VIEW).evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await waitForScrollToStop(page, VIEW);
    assertNear(await scrollTopOf(page, VIEW), bottom, 'a page reload keeps the Dictionary scrolled to the bottom');

    await page.evaluate(() => sessionStorage.setItem('ignatius-scroll-dict', '99999'));
    await page.reload();
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await waitForScrollToStop(page, VIEW);
    const stored = await page.evaluate(() => sessionStorage.getItem('ignatius-scroll-dict'));
    const clampLeftAlone = stored === '99999';
    assert(clampLeftAlone, `FAIL: a clamped restore leaves the saved position alone (got ${stored})`);
    if (clampLeftAlone) console.log('  PASS  a clamped restore leaves the saved position alone');

    await scrollTo(page, VIEW, TARGET);
    await page.goto(`${BASE}/#view=graph&entity=Payment`);
    await page.locator('[role="dialog"] a[href="#process-Collect-Payment"]').click();
    await page.locator(VIEW).waitFor({ state: 'visible' });
    await waitForScrollToStop(page, VIEW);
    // The sticky search header covers the top of the view, so the process lands just below it.
    const processOffset = await page.evaluate(id => {
      const el = document.getElementById(id);
      const view = el?.closest('.dict-view');
      return el && view ? el.getBoundingClientRect().top - view.getBoundingClientRect().top : Number.NaN;
    }, 'process-Collect-Payment');
    const landedOnProcess = Math.abs(processOffset) <= 100;
    assert(
      landedOnProcess,
      `FAIL: a process link from the entity modal scrolls to the process, not the remembered position (offset ${processOffset})`,
    );
    if (landedOnProcess) console.log('  PASS  a process deep link wins over scroll memory');

    await page.click('.dict-nav-tab');
    await page.waitForSelector('.dict-nav-panel.dict-nav-open');
    await waitForScrollToStop(page, NAV);
    const navMax = await page.locator(NAV).evaluate(el => el.scrollHeight - el.clientHeight);
    const navTarget = Math.min(300, navMax);
    assert(navTarget > 50, `FAIL: the sidebar has room to scroll (max ${navMax})`);
    await scrollTo(page, NAV, navTarget);
    await page.reload();
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await waitForScrollToStop(page, NAV);
    assert(await page.locator('.dict-nav-panel.dict-nav-open').count() === 1, 'FAIL: the sidebar is still open after a reload');
    assertNear(await scrollTopOf(page, NAV), navTarget, 'a page reload keeps the sidebar scroll');

    const noDiagramsNoLoad = mermaidRequests.length === 0;
    assert(noDiagramsNoLoad, `FAIL: a model without diagrams never loads mermaid.js (got ${mermaidRequests.length} requests)`);
    if (noDiagramsNoLoad) console.log('  PASS  a model without diagrams never loads mermaid.js');

    // Diagrams render after the restore and grow every body above the saved position.
    const entityDir = join(dir, 'data/transactional');
    const DIAGRAM = '\n```mermaid\nflowchart TD\n  A[Read] --> B{Valid?}\n  B -->|yes| C[(Write)]\n  B -->|no| D[Reject]\n  C --> E[Notify]\n  D --> E\n```\n';
    for (const file of readdirSync(entityDir)) {
      if (file.endsWith('.md') && file !== 'index.md') appendFileSync(join(entityDir, file), DIAGRAM);
    }
    await page.waitForFunction(() => document.querySelectorAll('.mermaid-diagram svg').length >= 5, undefined, { timeout: 30_000 });
    await waitForScrollToStop(page, VIEW);
    const grownTarget = await page.locator(VIEW).evaluate(el => {
      const diagrams = Array.from(el.querySelectorAll('.mermaid-diagram'));
      const last = diagrams[diagrams.length - 1];
      const below = last ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + 400 : 0;
      return Math.round(Math.min(below, el.scrollHeight - el.clientHeight - 100));
    });
    await scrollTo(page, VIEW, grownTarget);
    const diagramsAbove = await page.locator(VIEW).evaluate(el =>
      Array.from(el.querySelectorAll('.mermaid-diagram')).filter(d => d.getBoundingClientRect().bottom < el.getBoundingClientRect().top).length);
    assert(diagramsAbove >= 5, `FAIL: the saved position sits below the diagrams (${diagramsAbove} above it)`);
    await page.reload();
    await page.waitForSelector(VIEW, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll('.mermaid-diagram svg').length >= 5, undefined, { timeout: 30_000 });
    await waitForScrollToStop(page, VIEW);
    assertNear(await scrollTopOf(page, VIEW), grownTarget, 'a page reload lands on the saved position after diagrams above it render');

    assert(pageErrors.length === 0, `FAIL: no page errors (got ${pageErrors.join(' | ')})`);
    console.log(process.exitCode ? '\nscroll-memory: failures above.' : '\nAll scroll-memory checks passed.');
  } finally {
    await browser.close();
  }
} finally {
  handle.stop(true);
  clearTimeout(watchdog);
  rmSync(root, { recursive: true, force: true });
}
