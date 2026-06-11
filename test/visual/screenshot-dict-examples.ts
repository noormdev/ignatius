/**
 * Visual verification: dict examples accordion.
 *
 * Serves the cp3-fixture model (tmp/cp3-fixture/) which has two entities with
 * examples: Customer (3 rows — open by default) and Order (4 rows — closed).
 * Captures screenshots for manual review:
 *
 *   - tmp/dict-examples-customer.png — Customer entity with open accordion
 *   - tmp/dict-examples-order.png    — Order entity with closed accordion
 *   - tmp/dict-examples-full.png     — full /dict page
 *
 * Assertions are advisory (soft-fail) per spec; the script exits non-zero only
 * on a hard structural failure (no accordion found at all when expected).
 *
 * NOT run by `bun run test` — manual only.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'tmp', 'cp3-fixture');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3295;

let ok = true;
const note = (m: string) => console.log(m);
const warn = (m: string) => { console.warn('ADVISORY:', m); };
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

const handle = serveCommand(FIXTURE, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/dict`);
  // Wait for at least the first entity section to appear
  await page.waitForSelector('.entity-section', { timeout: 15_000 });
  await page.waitForTimeout(500);

  // Full page screenshot
  await page.screenshot({ path: join(TMP, 'dict-examples-full.png'), fullPage: true });
  note('Saved tmp/dict-examples-full.png');

  // Check Customer entity section (3 rows — should have open accordion)
  const customerSection = await page.$('#entity-Customer');
  if (!customerSection) {
    fail('Customer entity section not found in dict output');
  } else {
    await customerSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(TMP, 'dict-examples-customer.png') });
    note('Saved tmp/dict-examples-customer.png');

    // Advisory assertion: accordion open
    const openAccordion = await customerSection.$('details.dict-examples[open]');
    if (openAccordion) {
      note('Advisory PASS: Customer accordion is open (≤3 rows)');
    } else {
      warn('Customer accordion is not open — check ≤3 rows rule');
    }

    // Advisory assertion: Acme Corp row visible
    const html = await customerSection.innerHTML();
    if (html.includes('Acme Corp')) {
      note('Advisory PASS: "Acme Corp" example value visible in Customer accordion');
    } else {
      warn('"Acme Corp" not found in Customer entity section');
    }
  }

  // Check Order entity section (4 rows — should have closed accordion)
  const orderSection = await page.$('#entity-Order');
  if (!orderSection) {
    fail('Order entity section not found in dict output');
  } else {
    await orderSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(TMP, 'dict-examples-order.png') });
    note('Saved tmp/dict-examples-order.png');

    // Advisory assertion: accordion not open
    const openAccordion = await orderSection.$('details.dict-examples[open]');
    if (!openAccordion) {
      note('Advisory PASS: Order accordion is closed (>3 rows)');
    } else {
      warn('Order accordion is open — expected closed for >3 rows');
    }
  }

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nDict examples visual check FAILED (hard assertion).'); process.exit(1); }
console.log('\nDict examples visual check passed (screenshots saved to tmp/).');
