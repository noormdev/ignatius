// Manual only; needs `bun run build:bundle && bun run build:stable-names` first.

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { appendFileSync, cpSync, existsSync, mkdirSync, renameSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const TMP = join(ROOT, 'tmp');
const FIXTURE = join(TMP, 'mermaid-fixture');
const PORT = 7433;
const BASE = `http://localhost:${PORT}`;

const PROCESS_BODY = `
## Logic

\`\`\`mermaid
flowchart TD
  IN[/payment details/] --> M[(PaymentMethod)]
  M --> C{Card accepted?}
  C -->|yes| W[(Payment + PaymentAllocation)]
  C -->|no| R[Return decline to Customer]
  W --> OK[Send receipt]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant Customer
  participant Collect as Collect Payment
  participant Gateway
  Customer->>Collect: payment details
  Collect->>Gateway: authorise amount
  Gateway-->>Collect: approved
  Note over Collect,Gateway: response logged to gateway-log
  Collect-->>Customer: receipt
\`\`\`
`;

const ENTITY_BODY = `
## Lifecycle

\`\`\`mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Captured: gateway approves
  Pending --> Declined: gateway declines
  Captured --> Allocated: lines settled
  Allocated --> [*]
\`\`\`

\`\`\`mermaid
erDiagram
  PaymentMethod ||--o{ Payment : "is charged by"
  Payment ||--o{ PaymentAllocation : "is split into"
  Payment {
    uuid party_id PK
    int payment_id PK
    decimal amount
  }
  PaymentAllocation {
    int payment_id PK
    int line_seq PK
  }
\`\`\`
`;

const BROKEN_SOURCE = 'flowchart TD\n  A -->';
const BROKEN_BODY = `\n\`\`\`mermaid\n${BROKEN_SOURCE}\n\`\`\`\n`;

const OVERRIDE = `  mermaid:
    node_fills: ["#2a1f4a"]
    stroke_width: 2
    radius: 2
    shadow: false
    dark:
      lineColor: "#8b6cf0"
    light:
      lineColor: "#6d4fd8"
`;

if (existsSync(FIXTURE)) {
  mkdirSync(join(TMP, 'trash'), { recursive: true });
  renameSync(FIXTURE, join(TMP, 'trash', `mermaid-fixture-${Date.now()}`));
}
cpSync(join(ROOT, 'models', 'key-inherited'), FIXTURE, { recursive: true });
appendFileSync(join(FIXTURE, 'flows', 'order-to-cash', 'Collect-Payment.md'), PROCESS_BODY);
appendFileSync(join(FIXTURE, 'data', 'transactional', 'Payment.md'), ENTITY_BODY);
appendFileSync(join(FIXTURE, 'data', 'transactional', 'PaymentAllocation.md'), BROKEN_BODY);

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

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

async function waitForDiagrams(page: Page, scope: string, count: number): Promise<void> {
  await page.waitForFunction(
    ({ scope, count }) => document.querySelectorAll(`${scope} .mermaid-diagram[data-rendered] svg, ${scope} .mermaid-error`).length >= count,
    { scope, count },
    { timeout: 20_000 },
  );
  const errors = await page.locator(`${scope} .mermaid-error-message`).allTextContents();
  if (errors.length > 0) fail(`${scope} diagrams failed to render: ${errors.join(' | ')}`);
}

const DIAGRAMS = [
  ['#process-Collect-Payment', 0, 'logic'],
  ['#process-Collect-Payment', 1, 'flowchart'],
  ['#process-Collect-Payment', 2, 'sequence'],
  ['#entity-Payment', 0, 'state'],
  ['#entity-Payment', 1, 'er'],
] as const;

async function shoot(page: Page, scope: string, index: number, name: string): Promise<void> {
  const diagram = page.locator(`${scope} .mermaid-diagram`).nth(index);
  await diagram.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const path = join(TMP, name);
  await diagram.screenshot({ path });
  note(`Saved ${path}`);
}

async function firstNodeFill(page: Page): Promise<string> {
  return page.locator('#process-Collect-Payment .mermaid-diagram .node :is(rect, path, polygon)').first()
    .evaluate(el => getComputedStyle(el).fill);
}

const EDGE = '#process-Collect-Payment .mermaid-diagram .flowchart-link';

// Node fills stay the same in both modes; the connectors carry the mode.
async function firstEdgeStroke(page: Page): Promise<string> {
  return page.locator(EDGE).first().evaluate(el => getComputedStyle(el).stroke);
}

const proc = Bun.spawn(
  ['bun', 'src/cli/cli.ts', 'serve', FIXTURE, '--port', String(PORT)],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

try {
  const browser = await chromium.launch();
  try {
    if (!await waitForServer(BASE)) throw new Error('server did not start within 12 seconds');

    const strokes: Record<string, string> = {};
    for (const theme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
      await ctx.addInitScript(t => localStorage.setItem('ignatius-theme', t), theme);
      const page = await ctx.newPage();
      page.on('pageerror', e => fail(`[${theme}] page error: ${String(e)}`));
      await page.goto(`${BASE}/#view=graph`);
      await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
      await page.waitForTimeout(1500);
      const renderedWhileHidden = await page.locator('.mermaid-diagram[data-rendered]').count();
      if (renderedWhileHidden > 0) fail(`[${theme}] ${renderedWhileHidden} diagrams rendered inside the hidden Dictionary`);
      // A style-only reveal adds no nodes, so only the placeholders' resize can notice it.
      await page.evaluate(() => {
        const wrapper = document.querySelector('[data-ignatius="dict-view"]')?.parentElement;
        if (wrapper) wrapper.style.display = 'block';
      });
      await waitForDiagrams(page, '#process-Collect-Payment', 3)
        .catch(() => fail(`[${theme}] diagrams render when a style change reveals them`));
      await page.click('.fab');
      await page.getByRole('menuitem', { name: /Dictionary/ }).click();
      await page.waitForSelector('.dict-view', { state: 'visible', timeout: 20_000 });
      await waitForDiagrams(page, '#process-Collect-Payment', 3);
      await waitForDiagrams(page, '#entity-Payment', 2);
      strokes[theme] = await firstEdgeStroke(page);
      const accents = await page.evaluate(() => {
        const fillOf = (sel: string) => {
          const el = document.querySelector(`#process-Collect-Payment ${sel}`);
          return el ? getComputedStyle(el).fill : 'missing';
        };
        return {
          decision: [fillOf('g.node.ignatius-decision > polygon'), 'rgb(210, 153, 34)'],
          store: [fillOf('g.node.ignatius-store > path'), 'rgb(88, 166, 255)'],
        };
      });
      for (const [shape, [got, want]] of Object.entries(accents)) {
        if (got !== want) fail(`[${theme}] ${shape} nodes take the fill ${want}, got ${got}`);
      }

      const broken = page.locator('#entity-PaymentAllocation .mermaid-diagram.mermaid-error');
      await broken.waitFor({ timeout: 20_000 });
      const shownSource = await broken.locator('pre').textContent();
      const message = await broken.locator('.mermaid-error-message').textContent();
      if (shownSource?.trim() !== BROKEN_SOURCE) fail(`[${theme}] the error fallback shows the source, got ${JSON.stringify(shownSource)}`);
      if (!message) fail(`[${theme}] the error fallback shows the error text`);
      await page.locator('.changes-panel .side-panel-collapse').click();
      for (const [scope, index, kind] of DIAGRAMS) await shoot(page, scope, index, `mermaid-${kind}-${theme}.png`);
      await ctx.close();
    }
    if (strokes['dark'] === strokes['light']) fail(`connector colour is the same in both themes (${strokes['dark']})`);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    await ctx.addInitScript(() => localStorage.setItem('ignatius-theme', 'dark'));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#view=dict`);
    await waitForDiagrams(page, '#process-Collect-Payment', 3);
    await page.click('.theme-toggle');
    await page.waitForFunction(
      ({ selector, want }) => getComputedStyle(document.querySelector(selector) ?? document.body).stroke === want,
      { selector: EDGE, want: strokes['light'] },
      { timeout: 10_000 },
    ).catch(() => fail('a theme toggle re-renders diagrams with the other mode\'s colours'));
    await ctx.close();

    appendFileSync(join(FIXTURE, 'ignatius.yml'), OVERRIDE);
    for (const theme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
      await ctx.addInitScript(t => localStorage.setItem('ignatius-theme', t), theme);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/#view=dict`);
      await page.waitForSelector('.dict-view', { timeout: 20_000 });
      await waitForDiagrams(page, '#process-Collect-Payment', 3);
      const fill = await firstNodeFill(page);
      if (fill !== 'rgb(42, 31, 74)') fail(`[${theme}] theme.mermaid.node_fills fills nodes rgb(42, 31, 74), got ${fill}`);
      const outline = await page.locator('#process-Collect-Payment .mermaid-diagram .node :is(rect, path, polygon)').first()
        .evaluate(el => ({ width: getComputedStyle(el).strokeWidth, filter: getComputedStyle(el).filter }));
      if (outline.width !== '2px' || outline.filter !== 'none') fail(`[${theme}] stroke_width and shadow apply, got ${JSON.stringify(outline)}`);
      const label = await page.locator('#process-Collect-Payment .mermaid-diagram .nodeLabel').first().evaluate(el => getComputedStyle(el).color);
      if (label !== 'rgb(255, 255, 255)') fail(`[${theme}] labels on a dark node fill turn white, got ${label}`);
      await page.locator('.changes-panel .side-panel-collapse').click();
      await shoot(page, '#process-Collect-Payment', 0, `mermaid-override-${theme}.png`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  proc.kill();
}

if (!ok) { console.error('\nMermaid visual check FAILED.'); process.exit(1); }
console.log('\nMermaid visual check passed.');
