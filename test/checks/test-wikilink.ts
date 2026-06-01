/**
 * test-wikilink.ts — the `[[Entity]]` body-link inline rule.
 *
 * Pins the rendered HTML for: plain links, aliased links, missing targets,
 * code-span literals (must NOT become links), and the per-render link
 * collection used by validation.
 */

import MarkdownIt from 'markdown-it';
import { wikiLinkPlugin, splitWikiTarget, type WikiLinkEnv } from '../../src/wikilink';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// splitWikiTarget — the pure parser.
assert(JSON.stringify(splitWikiTarget('Customer')) === JSON.stringify({ target: 'Customer', label: 'Customer' }), 'plain target');
assert(JSON.stringify(splitWikiTarget('Customer|the buyer')) === JSON.stringify({ target: 'Customer', label: 'the buyer' }), 'aliased target');
assert(JSON.stringify(splitWikiTarget(' Customer | the buyer ')) === JSON.stringify({ target: 'Customer', label: 'the buyer' }), 'trims both sides');
assert(JSON.stringify(splitWikiTarget('Customer|')) === JSON.stringify({ target: 'Customer', label: 'Customer' }), 'empty label falls back to target');
console.log('PASS: splitWikiTarget');

const md = new MarkdownIt();
md.use(wikiLinkPlugin);

function render(src: string, knownIds?: string[]): { html: string; links: string[] } {
  const env: WikiLinkEnv = { knownIds: knownIds ? new Set(knownIds) : undefined, links: [] };
  const html = md.render(src, env);
  return { html, links: env.links! };
}

// Known target → navigable anchor carrying both href (dict) and data-entity (graph).
{
  const { html, links } = render('See [[Customer]] for details.', ['Customer']);
  assert(html.includes('<a class="entity-link" data-entity="Customer" href="#entity-Customer">Customer</a>'), `known link anchor (got: ${html})`);
  assert(JSON.stringify(links) === JSON.stringify(['Customer']), 'collects the referenced target');
  console.log('PASS: known target renders a navigable anchor');
}

// Alias → label differs from target, link still points at the entity.
{
  const { html } = render('Billed to [[Customer|the buyer]].', ['Customer']);
  assert(html.includes('data-entity="Customer"') && html.includes('>the buyer</a>'), `alias label (got: ${html})`);
  console.log('PASS: alias renders label, links to target');
}

// Unknown target → non-navigating missing span (no data-entity, no href).
{
  const { html, links } = render('Owned by [[Ghost]].', ['Customer']);
  assert(html.includes('<span class="entity-link entity-link--missing" title="Unknown entity: Ghost">Ghost</span>'), `missing span (got: ${html})`);
  assert(!html.includes('data-entity="Ghost"') && !html.includes('href="#entity-Ghost"'), 'missing target has no nav attributes');
  assert(JSON.stringify(links) === JSON.stringify(['Ghost']), 'unknown target still collected for validation');
  console.log('PASS: unknown target renders a non-navigating missing span');
}

// No knownIds env → optimistic link (used for group descriptions parsed before ids exist).
{
  const { html } = render('Group of [[Anything]].');
  assert(html.includes('<a class="entity-link" data-entity="Anything"'), `optimistic link without knownIds (got: ${html})`);
  console.log('PASS: optimistic link when knownIds absent');
}

// Code spans and fenced code must stay literal — never become links.
{
  const { html, links } = render('Use the `[[Customer]]` syntax.', ['Customer']);
  assert(!html.includes('entity-link'), `inline code stays literal (got: ${html})`);
  assert(links.length === 0, 'no links collected from code span');
  const fenced = render('```\n[[Customer]]\n```', ['Customer']);
  assert(!fenced.html.includes('entity-link'), `fenced code stays literal (got: ${fenced.html})`);
  console.log('PASS: code spans and fences stay literal');
}

// HTML in the label/target is escaped — no injection from authored markdown.
{
  const { html } = render('[[Customer|<img src=x onerror=alert(1)>]]', ['Customer']);
  assert(!html.includes('<img'), `label is escaped (got: ${html})`);
  console.log('PASS: label is HTML-escaped');
}

// A lone bracket pair is left untouched (standard markdown still works).
{
  const { html } = render('A normal [link](https://example.com) and [text].', []);
  assert(html.includes('href="https://example.com"') && !html.includes('entity-link'), `standard links untouched (got: ${html})`);
  console.log('PASS: standard markdown links untouched');
}

console.log('\nAll wikilink checks passed.');
