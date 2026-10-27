// Manual only; needs `bun run build:bundle && bun run build:stable-names` first.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { appendFileSync, cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp');
const FIXTURE = join(TMP, 'md-typography-fixture');
const PORT = 7431;
const BASE = `http://localhost:${PORT}`;

const RICH_BODY = `
## Settlement rules

A payment is the settlement event. Each rule below is enforced by the
database, not by the application, so a bad write fails loudly.

- **Amount is positive** — zero or negative sums are rejected.
- **Allocations never exceed the payment**
  - summed per \`payment_id\`
  - checked on every \`PaymentAllocation\` insert
- **Currency is fixed** once the payment is captured.

1. Look up the stored method.
2. Record the payment.
3. Allocate it against invoice lines.

> Refunds are new payments with a negative allocation, never an edit of the
> original row. The money trail stays append-only.

### Example query

\`\`\`
payment 9001 → invoice 5001 line 1   49.99 GBP
payment 9002 → invoice 5002 line 1  199.00 USD
\`\`\`

\`\`\`sql
SELECT payment_id, SUM(amount) AS allocated
FROM payment_allocation
GROUP BY payment_id;
\`\`\`

| Column | Meaning |
|---|---|
| \`amount\` | Sum received, in the payment currency |
| \`paid_at\` | When the gateway confirmed the capture |

---

#### Open questions

Partial captures are out of scope for this model.
`;

if (existsSync(FIXTURE)) {
  mkdirSync(join(TMP, 'trash'), { recursive: true });
  renameSync(FIXTURE, join(TMP, 'trash', `md-typography-fixture-${Date.now()}`));
}
cpSync(join(ROOT, 'models', 'key-inherited'), FIXTURE, { recursive: true });
appendFileSync(join(FIXTURE, 'data', 'transactional', 'Payment.md'), RICH_BODY);
appendFileSync(join(FIXTURE, 'flows', 'order-to-cash', 'Collect-Payment.md'), RICH_BODY);
mkdirSync(join(FIXTURE, '.ignatius', 'changes'), { recursive: true });
writeFileSync(join(FIXTURE, '.ignatius', 'changes', 'settlement-rules.md'), `---
title: Document settlement rules
entities:
  Payment: []
flows:
  order-to-cash: [Collect-Payment]
---

# Why

Reviewers kept asking how refunds settle.

## What moved

- Payment gains a rules section.
- Collect Payment repeats it for the process view.

### Follow-up

Partial captures stay out of scope.
`);

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', FIXTURE, '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

async function waitForServer(url: string, timeout = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(200);
  }
  return false;
}

async function shotOf(page: Page, selector: string, name: string): Promise<void> {
  const found = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    // Leave the card's preceding rows in frame, clear of the sticky search bar.
    document.querySelector('.dict-view')?.scrollBy(0, -160);
    return true;
  }, selector);
  if (!found) { fail(`${selector} not found for ${name}`); return; }
  await page.waitForTimeout(300);
  const path = join(TMP, name);
  await page.screenshot({ path });
  note(`Saved ${path}`);
}

const browser = await chromium.launch();

try {
  if (!await waitForServer(BASE)) throw new Error('server did not start within 12 seconds');

  for (const theme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    await ctx.addInitScript(t => localStorage.setItem('ignatius-theme', t), theme);
    const page = await ctx.newPage();

    await page.goto(`${BASE}/#view=dict`);
    await page.waitForSelector('.dict-view', { timeout: 20_000 });
    await page.waitForTimeout(800);

    const h2 = page.locator('#entity-Payment .md h2').first();
    if (await h2.count() === 0) {
      fail(`[${theme}] Payment body has no markdown h2`);
    } else {
      const transform = await h2.evaluate(el => getComputedStyle(el).textTransform);
      if (transform !== 'none') fail(`[${theme}] h2 inside .md is ${transform}, want none`);
    }

    const changeNote = page.locator('.changes-panel-note').first();
    await changeNote.waitFor({ timeout: 5_000 });
    const fontSize = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    const headingSizes = await changeNote.locator('.md :is(h1, h2, h3, h4, h5, h6)').evaluateAll(
      els => els.map(el => parseFloat(getComputedStyle(el).fontSize)),
    );
    if (headingSizes.length === 0) fail(`[${theme}] change-note body has no headings to check`);
    const sizes = {
      title: await changeNote.locator('> h4').evaluate(fontSize),
      heading: Math.max(...headingSizes),
    };
    if (sizes.heading > sizes.title) {
      fail(`[${theme}] change-note body heading ${sizes.heading}px outranks the ${sizes.title}px note title`);
    }
    const notePath = join(TMP, `md-typography-change-note-${theme}.png`);
    await page.locator('.changes-panel').screenshot({ path: notePath });
    note(`Saved ${notePath}`);
    await page.locator('.changes-panel .side-panel-collapse').click();

    await shotOf(page, '.dict-group-desc.md', `md-typography-group-${theme}.png`);
    await shotOf(page, '#entity-Payment .md', `md-typography-entity-${theme}.png`);
    await shotOf(page, '#process-Collect-Payment .md', `md-typography-process-${theme}.png`);

    await page.goto(`${BASE}/#view=graph`);
    await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
    await page.waitForTimeout(2500);
    const tapped = await page.evaluate(() => {
      const cy = window.__IGNATIUS_CY__;
      const node = cy?.$id('Payment');
      if (!node || node.length === 0) return false;
      node.emit('tap');
      return true;
    });
    if (!tapped) fail(`[${theme}] Payment node not found in graph`);
    await page.waitForSelector('.modal .doc-body.md', { timeout: 5_000 });
    await page.waitForTimeout(300);
    const path = join(TMP, `md-typography-modal-${theme}.png`);
    await page.screenshot({ path });
    note(`Saved ${path}`);

    await ctx.close();
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  proc.kill();
}

if (!ok) { console.error('\nMarkdown typography visual check FAILED.'); process.exit(1); }
console.log('\nMarkdown typography visual check passed.');
