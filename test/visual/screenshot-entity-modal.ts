/**
 * Visual verification: entity-detail modal with examples accordion.
 *
 * Serves a minimal cp4-fixture (tmp/cp4-fixture/) with one entity carrying
 * 3 example rows. Validates:
 *   - Node tap opens the modal (.modal-backdrop present)
 *   - Modal contains .modal-examples accordion (hard assertion)
 *   - ESC closes the modal (.modal-backdrop gone)
 *   - Hash still contains entity=Customer after close (selection persists)
 *
 * Screenshots:
 *   - tmp/modal-open.png  — modal visible with examples
 *   - tmp/modal-closed.png — modal dismissed, graph still has entity selected
 *
 * NOT run by `bun run test` — manual only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'tmp', 'cp4-fixture');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

// Build fixture inline
mkdirSync(join(FIXTURE, '_groups'), { recursive: true });
writeFileSync(join(FIXTURE, 'ignatius.yml'), `name: CP-4 Fixture
version: "1.0"
description: Minimal fixture for entity-modal visual test
`);
writeFileSync(join(FIXTURE, '_groups', 'core.md'), `---
group: core
label: Core
color: "#4f86c6"
---
`);
writeFileSync(join(FIXTURE, 'Customer.md'), `---
entity: Customer
group: core
pk:
  - customer_id
columns:
  customer_id:
    type: uuid
  name:
    type: text
  email:
    type: text
examples:
  - customer_id: "cust-001"
    name: Acme Corp
    email: billing@acme.com
  - customer_id: "cust-002"
    name: Globex Ltd
    email: info@globex.com
  - customer_id: "cust-003"
    name: Initech
    email: help@initech.com
---

Registered customers.
`);

const PORT = 3298;

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

const handle = serveCommand(FIXTURE, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForTimeout(2500);

  // Tap the Customer node via the Cytoscape debug seam
  const nodeFound = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__;
    if (!cy) return false;
    const node = cy.$id('Customer');
    if (node.length === 0) return false;
    cy.fit(node, 100);
    node.emit('tap');
    return true;
  });

  if (!nodeFound) {
    fail('Customer node not found in Cytoscape instance');
    process.exit(1);
  }

  // Wait for modal to appear
  await page.waitForSelector('.modal-backdrop', { timeout: 5_000 });
  await page.waitForTimeout(300);

  await page.screenshot({ path: join(TMP, 'modal-open.png') });
  note('Saved tmp/modal-open.png');

  // Hard assertion: .modal-examples accordion must be present
  const examplesEl = await page.$('.modal-examples');
  if (examplesEl) {
    note('PASS: .modal-examples accordion found in modal');
  } else {
    fail('.modal-examples not found in modal — examples accordion not rendered');
  }

  // Advisory: accordion open (≤3 rows)
  const openAccordion = await page.$('details.modal-examples[open]');
  if (openAccordion) {
    note('Advisory PASS: accordion is open (≤3 rows)');
  } else {
    note('Advisory NOTE: accordion not open — check open-when-≤3-rows rule');
  }

  // Advisory: example data visible
  const modalHtml = await page.$eval('.modal', (el) => el.innerHTML);
  if (modalHtml.includes('Acme Corp')) {
    note('Advisory PASS: "Acme Corp" example value visible in modal');
  } else {
    note('Advisory NOTE: "Acme Corp" not found in modal HTML');
  }

  // Close modal with ESC
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Modal must be gone
  const backdropAfterEsc = await page.$('.modal-backdrop');
  if (!backdropAfterEsc) {
    note('PASS: modal closed on ESC');
  } else {
    fail('modal still visible after ESC');
  }

  await page.screenshot({ path: join(TMP, 'modal-closed.png') });
  note('Saved tmp/modal-closed.png');

  // Hash must still contain entity=Customer (selection persists)
  const hash = await page.evaluate(() => window.location.hash);
  if (hash.includes('entity=Customer')) {
    note(`PASS: hash still contains entity=Customer after close (hash="${hash}")`);
  } else {
    fail(`hash does not contain entity=Customer after modal close — got "${hash}"`);
  }

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nEntity modal visual check FAILED.'); process.exit(1); }
console.log('\nEntity modal visual check passed (screenshots saved to tmp/).');
