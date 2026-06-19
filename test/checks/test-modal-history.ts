/**
 * CP2 (viewer-ux-polish) entity-modal history + URL sync — integration check.
 *
 * Proves the #6/#8 contract in a real browser against models/key-inherited:
 *
 *   1. Opening an entity modal puts entity=<id> in location.hash AND pushes a
 *      history entry. (Open from the Dictionary browse-lens ⓘ button → the
 *      shared openEntityById opener.)
 *   2. An FK hop A→B from inside A's modal pushes again, so the back-stack is
 *      …→A→B. Browser Back (window.history.back()) returns to A's modal; a
 *      second Back closes the modal entirely.
 *   3. Clicking the modal close button clears entity= from location.hash
 *      (replaceState — clean URL, distinct from Back).
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds the
 * bundle before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
  process.exit(0);
}

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const PORT = 3298;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const hash = () => page.evaluate(() => location.hash);
// Extract the exact entity= param value (null when absent). Substring matching
// on the raw hash is unsafe — e.g. "entity=PartyType" contains "entity=Party".
const entityParam = () => page.evaluate(() => {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  return new URLSearchParams(raw).get('entity');
});
const modalTitle = () => page.evaluate(() => {
  const h = document.querySelector('.modal .modal-header h1');
  return h ? h.textContent ?? '' : null;
});

try {
  // Force the Dictionary browse lens BEFORE first paint so the grid (with ⓘ
  // open buttons) renders deterministically.
  await page.addInitScript(() => {
    localStorage.setItem('ignatius-dict-lens', 'browse');
  });

  await page.goto(`http://localhost:${PORT}/#view=dict`, { waitUntil: 'load' });
  await page.waitForSelector('[data-ignatius="dict-view"]', { timeout: 20_000 });
  // Wait for the browse grid to be populated.
  await page.waitForSelector('.dict-grid-card-info', { timeout: 10_000 });
  await new Promise<void>(r => setTimeout(r, 300));

  // ── 1. Open entity Party via its ⓘ button → entity= appears in the hash ──
  await page.click('[aria-label="Open Party details"]');
  await page.waitForSelector('.modal .modal-header h1', { timeout: 5000 });
  await page.waitForFunction(() => location.hash.includes('entity=Party'), { timeout: 3000 });

  assert(
    (await hash()).includes('entity=Party'),
    'open Party: location.hash carries entity=Party',
    `hash: ${await hash()}`,
  );
  assert(
    (await modalTitle()) === 'Party',
    'open Party: modal shows Party',
    `title: ${await modalTitle()}`,
  );

  // ── 2. FK hop A→B: click the first relationship link inside Party's modal ──
  // Party is a subtype basetype, so its modal lists child entities as .fk-link
  // anchors. Clicking one opens a DIFFERENT entity and pushes a second entry.
  const fkTarget = await page.evaluate(() => {
    const link = document.querySelector('.modal .fk-link');
    return link ? (link.textContent ?? '').trim() : null;
  });
  assert(fkTarget !== null && fkTarget.length > 0, 'Party modal has an FK link to hop to', `fkTarget: ${fkTarget}`);

  await page.click('.modal .fk-link');
  // Wait until the modal title changes away from Party.
  await page.waitForFunction(() => {
    const h = document.querySelector('.modal .modal-header h1');
    return h !== null && (h.textContent ?? '') !== 'Party';
  }, { timeout: 5000 });

  const entityB = await modalTitle();
  assert(
    entityB !== null && entityB !== 'Party',
    'FK hop: a different entity modal opened (B != Party)',
    `B title: ${entityB}`,
  );
  // The hash now carries entity=<B>. Compare the exact param value, not a
  // substring (entity=PartyType would falsely contain "entity=Party").
  const entityAfterHop = await entityParam();
  assert(
    entityAfterHop !== null && entityAfterHop !== 'Party',
    'FK hop: location.hash entity= switched away from Party',
    `entity param: ${entityAfterHop}`,
  );

  // ── 2b. Browser Back → returns to Party's modal (back-stack is …→Party→B) ──
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => location.hash.includes('entity=Party'), { timeout: 3000 });
  await new Promise<void>(r => setTimeout(r, 200));

  assert(
    (await hash()).includes('entity=Party'),
    'Back: location.hash returns to entity=Party',
    `hash: ${await hash()}`,
  );
  assert(
    (await modalTitle()) === 'Party',
    'Back: Party modal is shown again',
    `title: ${await modalTitle()}`,
  );

  // ── 2c. Browser Back again → no entity= in hash, modal closed ──
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(() => !location.hash.includes('entity='), { timeout: 3000 });
  await new Promise<void>(r => setTimeout(r, 200));

  assert(
    !(await hash()).includes('entity='),
    'Back again: location.hash has NO entity= (stepped off the modal stack)',
    `hash: ${await hash()}`,
  );
  assert(
    (await page.evaluate(() => document.querySelector('.modal'))) === null,
    'Back again: modal is closed',
  );

  // ── 3. Re-open, then CLOSE via the × button → entity= cleared from the hash ──
  await page.click('[aria-label="Open Party details"]');
  await page.waitForSelector('.modal .modal-header h1', { timeout: 5000 });
  await page.waitForFunction(() => location.hash.includes('entity=Party'), { timeout: 3000 });
  assert(
    (await hash()).includes('entity=Party'),
    're-open Party: entity=Party in hash before close',
  );

  await page.click('.modal .modal-close');
  await page.waitForFunction(() => !location.hash.includes('entity='), { timeout: 3000 });
  await new Promise<void>(r => setTimeout(r, 200));

  assert(
    !(await hash()).includes('entity='),
    'close button: entity= cleared from location.hash',
    `hash: ${await hash()}`,
  );
  assert(
    (await page.evaluate(() => document.querySelector('.modal'))) === null,
    'close button: modal is closed',
  );

} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP2 modal-history: all assertions passed.');
process.exit(0);
