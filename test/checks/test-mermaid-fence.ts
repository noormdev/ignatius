/** test-mermaid-fence.ts — a ```mermaid fence in an entity or process body reaches bodyHtml as an
 *  escaped `div.mermaid-diagram`; other fences render exactly as before. */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModels } from '../../src/model/parse';
import { parseFlows, type FlowDiagram, type FlowProcess } from '../../src/flows/flow-parse';
import MarkdownIt from 'markdown-it';
import { highlightCodeFence } from '../../src/model/markdown-highlight';
import { assert, must } from '../assert';

const SOURCE = 'flowchart TD\n  A["a < b & \\"c\\""] --> B';
const ESCAPED = 'flowchart TD\n  A[&quot;a &lt; b &amp; \\&quot;c\\&quot;&quot;] --&gt; B\n';
const EXPECTED = `<div class="mermaid-diagram">${ESCAPED}</div>`;
function allProcesses(diagrams: FlowDiagram[]): FlowProcess[] {
  return diagrams.flatMap(d => [...d.processes, ...allProcesses(d.subDfds)]);
}

const SQL_FENCE = '```sql\nselect 1;\n```';

const root = mkdtempSync(join(tmpdir(), 'ignatius-mermaid-fence-'));
try {
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'flows/checkout'), { recursive: true });
  mkdirSync(join(root, 'externals'));
  writeFileSync(join(root, 'ignatius.yml'), 'name: Fence\n');
  writeFileSync(
    join(root, 'data/Customer.md'),
    `---\nentity: Customer\npk: [customer_id]\ncolumns:\n  customer_id:\n    type: uuid\n---\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`,
  );
  writeFileSync(
    join(root, 'data/Order.md'),
    `---\nentity: Order\npk: [order_id]\ncolumns:\n  order_id:\n    type: uuid\n---\n\n${SQL_FENCE}\n`,
  );
  writeFileSync(join(root, 'externals/Buyer.md'), '---\nexternal: Buyer\n---\n');
  writeFileSync(
    join(root, 'flows/checkout/Pay.md'),
    `---\nprocess: Pay\nnumber: 1\ninputs:\n  - from: ext:Buyer\n    data: card\noutputs:\n  - to: ext:Buyer\n    data: receipt\n---\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`,
  );

  const { model } = await parseModels(root);
  const node = (id: string) => must(model.nodes.find(n => n.id === id), `${id} node`);
  const entityHtml = node('Customer').bodyHtml;
  assert(entityHtml.trim() === EXPECTED, `FAIL: entity body renders the mermaid div, got ${JSON.stringify(entityHtml)}`);

  const { flowModel } = await parseFlows(root);
  const processHtml = must(
    allProcesses(flowModel.diagrams).find(p => p.label === 'Pay'),
    'Pay process',
  ).bodyHtml;
  assert(processHtml.trim() === EXPECTED, `FAIL: process body renders the mermaid div, got ${JSON.stringify(processHtml)}`);

  const sqlHtml = node('Order').bodyHtml;
  const plainSqlHtml = new MarkdownIt({ highlight: highlightCodeFence }).render(SQL_FENCE);
  assert(sqlHtml === plainSqlHtml, `FAIL: a sql fence renders as it did without the plugin, got ${JSON.stringify(sqlHtml)}`);

  assert(!entityHtml.includes('<pre'), 'FAIL: the mermaid fence is not also rendered as a code block');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(process.exitCode ? 'mermaid-fence: failures above.' : 'All mermaid-fence checks passed.');
