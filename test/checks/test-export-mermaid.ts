/** test-export-mermaid.ts — an export inlines the Mermaid sidecar, escaped and before the app script,
 *  only when some body has a diagram; the live server serves it and tints decision, store and end-state shapes. */

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { generateApp } from '../../src/generators/app';
import { chromium } from 'playwright';
import { serveCommand } from '../../src/server/server';
import type { BundleContent } from '../../src/generators/embedded-bundle';
import { assert } from '../assert';

const SENTINEL = 'MERMAID_SIDECAR_SENTINEL';
const bundle: BundleContent = {
  htmlTemplate:
    '<!doctype html><html><head><link rel="stylesheet" href="index-abc.css"></head><body>' +
    `<script>window.__IGNATIUS_MODE__ = 'live';</script><script type="module" src="index-abc.js"></script></body></html>`,
  cssContent: '',
  jsContent: 'console.log("APP_SCRIPT");',
  mermaidJs: `/* ${SENTINEL} */ var s = "</script>";`,
};

const FENCE = '```mermaid\nflowchart TD\n  A --> B\n```';

function writeModel(root: string, entityBody: string, processBody: string): void {
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'flows/checkout'), { recursive: true });
  mkdirSync(join(root, 'externals'));
  writeFileSync(join(root, 'ignatius.yml'), 'name: Export\n');
  writeFileSync(
    join(root, 'data/Customer.md'),
    `---\nentity: Customer\npk: [customer_id]\ncolumns:\n  customer_id:\n    type: uuid\n---\n\n${entityBody}\n`,
  );
  writeFileSync(join(root, 'externals/Buyer.md'), '---\nexternal: Buyer\n---\n');
  writeFileSync(
    join(root, 'flows/checkout/Pay.md'),
    `---\nprocess: Pay\nnumber: 1\ninputs:\n  - from: ext:Buyer\n    data: card\noutputs:\n  - to: ext:Buyer\n    data: receipt\n---\n\n${processBody}\n`,
  );
}

async function exportOf(entityBody: string, processBody: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ignatius-export-mermaid-'));
  try {
    writeModel(root, entityBody, processBody);
    const { model } = await parseModels(root);
    const { flowModel } = await parseFlows(root);
    return await generateApp(model, flowModel, bundle);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const withEntityDiagram = await exportOf(FENCE, 'Plain.');
assert(withEntityDiagram.includes(SENTINEL), 'FAIL: an entity-body diagram inlines mermaid.js');
assert(
  withEntityDiagram.indexOf(SENTINEL) < withEntityDiagram.indexOf('APP_SCRIPT'),
  'FAIL: mermaid.js is inlined before the app script',
);
assert(!withEntityDiagram.includes('var s = "</script>"'), 'FAIL: </script> inside mermaid.js is escaped');

const withProcessDiagram = await exportOf('Plain.', FENCE);
assert(withProcessDiagram.includes(SENTINEL), 'FAIL: a process-body diagram inlines mermaid.js');

const without = await exportOf('Plain.', 'Plain.');
assert(!without.includes(SENTINEL), 'FAIL: a model without diagrams carries no mermaid.js');

// The accent selectors lean on Mermaid's markup (mermaid-render.ts tagFlowchartShapes and
// the end-state rule in styles.css), so a Mermaid upgrade that changes it fails here.
const SHAPES_BODY = [
  '```mermaid\nflowchart TD\n  A[Start] --> B{Valid?}\n  B -->|yes| C[(Orders)]\n  B -->|no| D[/Reject/]\n```',
  '```mermaid\nstateDiagram-v2\n  [*] --> Open\n  Open --> [*]\n```',
].join('\n\n');

async function checkShapeAccents(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:7437/#view=dict');
    await page.waitForFunction(() => document.querySelectorAll('.mermaid-diagram[data-rendered] svg').length === 2, undefined, { timeout: 30_000 });
    const fills = await page.evaluate(() => {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const cssColor = (name: string) => {
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name);
        return getComputedStyle(probe).color;
      };
      const fillOf = (selector: string) => {
        const found = document.querySelectorAll(selector);
        return found.length === 1 && found[0] ? getComputedStyle(found[0]).fill : `${found.length} matches`;
      };
      const result = {
        decision: [fillOf('g.node.ignatius-decision > polygon'), cssColor('--badge-dependent-bg')],
        store: [fillOf('g.node.ignatius-store > path'), cssColor('--badge-independent-bg')],
        'end state': [fillOf('g.node[id*="_end-"] g:not(.outer-path) > path:first-child'), cssColor('--color-text-muted')],
      };
      probe.remove();
      return result;
    });
    for (const [shape, [got, want]] of Object.entries(fills)) {
      assert(got === want, `FAIL: the ${shape} accent fills ${want}, got ${got}`);
    }
    const parallelogramTagged = await page.locator('g.node[id*="-flowchart-D-"].ignatius-decision').count();
    assert(parallelogramTagged === 0, 'FAIL: a parallelogram is not mistaken for a decision');
  } finally {
    await browser.close();
  }
}

if (existsSync(join(import.meta.dir, '../../dist/static/mermaid.js'))) {
  const root = mkdtempSync(join(tmpdir(), 'ignatius-mermaid-route-'));
  writeModel(root, SHAPES_BODY, 'Plain.');
  const handle = serveCommand(root, { port: 7437 });
  try {
    const res = await fetch('http://localhost:7437/static/mermaid.js');
    const body = await res.text();
    assert(res.status === 200, `FAIL: GET /static/mermaid.js returns 200, got ${res.status}`);
    assert(res.headers.get('content-type')?.startsWith('text/javascript') === true, `FAIL: mermaid.js is served as text/javascript, got ${res.headers.get('content-type')}`);
    assert(body.includes('__IGNATIUS_MERMAID__'), 'FAIL: the served file registers window.__IGNATIUS_MERMAID__');
    await checkShapeAccents();
  } finally {
    handle.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
} else {
  console.log('SKIP: dist/static/mermaid.js not built; the /static/mermaid.js route is not checked.');
}

console.log(process.exitCode ? 'export-mermaid: failures above.' : 'All export-mermaid checks passed.');
