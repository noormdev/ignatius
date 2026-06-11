/**
 * test-flow-wikilink.ts — flow markdown renders `[[Target]]` body links as
 * navigable `a.entity-link[data-entity]` anchors (same inline rule as ERD entity
 * bodies). This is what lets the flow viewer's doc dialog route `[[links]]` to
 * other docs. Rendered optimistically — every target becomes an anchor; the
 * viewer resolves it at click time.
 */

import { parseFlows } from '../../src/flows/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

const { flowModel, globalErrors } = await parseFlows('models/key-inherited');
assert(globalErrors.length === 0, `parseFlows key-inherited — expected no globalErrors, got: ${JSON.stringify(globalErrors)}`);

// Find the Collect Payment process — its body carries `[[Payment]]`, `[[PaymentMethod]]`,
// `[[PaymentAllocation]]`, `[[Customer]]` wiki-links.
function findProcess(diagrams: typeof flowModel.diagrams, id: string): { bodyHtml: string } | null {
  for (const d of diagrams) {
    const p = d.processes.find(pr => pr.id === id);
    if (p) return p;
    const sub = findProcess(d.subDfds, id);
    if (sub) return sub;
  }
  return null;
}

const collect = findProcess(flowModel.diagrams, 'Collect-Payment');
assert(collect !== null, 'Collect-Payment process found');

const html = collect.bodyHtml;
assert(
  html.includes('class="entity-link"') && html.includes('data-entity="Payment"'),
  `Collect Payment body renders a navigable [[Payment]] anchor; got:\n${html}`,
);
console.log('PASS: flow body [[Payment]] renders as a navigable entity-link anchor');

for (const target of ['PaymentMethod', 'PaymentAllocation', 'Customer']) {
  assert(html.includes(`data-entity="${target}"`), `[[${target}]] renders a data-entity anchor`);
}
console.log('PASS: all flow-body wiki-links render data-entity anchors');

// A column-name code span must stay literal (not become a wiki-link).
assert(html.includes('<code>amount</code>'), 'inline code `amount` stays a code span, not a link');
console.log('PASS: inline code spans untouched by the wiki-link rule');

console.log('\nAll flow wikilink checks passed.');
