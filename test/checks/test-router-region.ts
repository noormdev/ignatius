/**
 * test-router-region.ts — verifies the managed-region primitives that back
 * the router writer: locate an `<ignatius-*>` block, read its inner content,
 * and replace it in place without disturbing anything outside it.
 *
 * Cases from docs/spec/model-index-routing.md's Risks table:
 *   1. no region in the file
 *   2. exactly one region
 *   3. two differently-named regions in one file, only the targeted one replaced
 *   4a. a fenced example inside <ignatius-rules> whose tag lines are indented
 *       survives verbatim, and the index region is appended
 *   4b. the same fenced example with its tag lines at column 0 throws,
 *       naming indentation as the fix
 *   4c. a column-0 fenced example with no real sibling region IS the region
 *       — replaced in place, fence lines and prose survive
 *   5. CRLF input, including line-ending consistency of the output
 *   6. replacing preserves every byte outside the region, including a
 *      hand-authored <ignatius-rules> block
 *   7. replace is idempotent, and survives pre-existing hand-authored prose
 *   8. nested same-name regions throw rather than silently drop content
 *   9. an orphaned/unclosed opening tag throws rather than being treated as
 *      appendable
 *   10. two regions sharing the same name throw rather than orphaning one
 *   11. a wrapped (multi-line) opening tag attribute list still parses
 *   12. a tight, hand-authored <ignatius-rules> block (no interior blank
 *       lines) survives an <ignatius-index> append
 *   13. a tight region of the same name being replaced also works
 *   14. a hand-authored `↑ ...` line above a region-less index survives
 *       verbatim, and the generator-owned <ignatius-breadcrumb> region is
 *       inserted alongside it (both by design)
 *   15. an <ignatius-*> tag name mentioned mid-line (backticks included) is
 *       text, not a boundary
 *   15b/15c. genuine nested/duplicate-closer cases still throw with inline
 *       code present elsewhere in the file
 *   16. one-space- and tab-indented tag mentions inside rules are text, not
 *       boundaries
 *   17. an orphan closing tag alone throws
 *   18. a mismatched closer throws, naming both tags
 *   19. a whole column-0 tag inside inline code, plus a second closer, throws
 *   20. a back-to-back tag pair is an empty region, not an unclosed one
 *   21. thrown messages carry a 1-based line number (and "indent" where
 *       applicable)
 */

import { readRegion, replaceRegion } from '../../src/router/region';
import { writeRouters } from '../../src/router/write';
import type { RouterFile } from '../../src/router/build';
import { assert } from '../assert';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 1 — no region present
{
  const content = '# Heading\n\nSome prose.\n';
  assert(
    readRegion(content, 'ignatius-index') === null,
    'FAIL(1): readRegion should return null when no region exists',
  );
}

// 2 — exactly one region, read and replace
{
  const content = [
    '# Heading',
    '',
    '<ignatius-index scope="entity-group">',
    '',
    '| A |',
    '|---|',
    '| 1 |',
    '',
    '</ignatius-index>',
    '',
    'Trailing prose.',
    '',
  ].join('\n');

  assert(
    readRegion(content, 'ignatius-index') === '| A |\n|---|\n| 1 |',
    `FAIL(2): readRegion should extract the table, got ${JSON.stringify(readRegion(content, 'ignatius-index'))}`,
  );

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'entity-group' }, '| B |\n|---|\n| 2 |');
  assert(
    readRegion(replaced, 'ignatius-index') === '| B |\n|---|\n| 2 |',
    'FAIL(2): replaceRegion should swap the inner content',
  );
  assert(
    replaced.includes('# Heading') && replaced.includes('Trailing prose.'),
    'FAIL(2): replaceRegion should leave surrounding prose untouched',
  );
}

// 3 — two differently-named regions, only the targeted one replaced
{
  const content = [
    '<ignatius-index scope="a">',
    '',
    'first',
    '',
    '</ignatius-index>',
    '',
    '<ignatius-rules>',
    '',
    'hand-authored',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'second');
  assert(
    readRegion(replaced, 'ignatius-index') === 'second',
    'FAIL(3): the targeted region should be replaced',
  );
  assert(
    readRegion(replaced, 'ignatius-rules') === 'hand-authored',
    'FAIL(3): the other region should be untouched',
  );
}

// 4a — a fenced example inside <ignatius-rules>, tag lines indented one
// space, survives verbatim and the index region is appended
{
  const content = [
    '<ignatius-rules>',
    '',
    '```markdown',
    ' <ignatius-index scope="fake">',
    '',
    ' example',
    '',
    ' </ignatius-index>',
    '```',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  assert(
    replaced.includes(' <ignatius-index scope="fake">') && replaced.includes(' </ignatius-index>'),
    'FAIL(4a): the indented fenced example must survive verbatim',
  );
  assert(
    readRegion(replaced, 'ignatius-index') === 'ROWS',
    'FAIL(4a): the new region should be appended',
  );
}

// 4b — the same fenced example with its tag lines at column 0 throws,
// naming indentation as the fix
{
  const content = [
    '<ignatius-rules>',
    '',
    '```markdown',
    '<ignatius-index scope="fake">',
    '',
    'example',
    '',
    '</ignatius-index>',
    '```',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');

  let message = '';
  try {
    replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message !== '', 'FAIL(4b): a column-0 tag inside a fence nested in another region must throw');
  assert(
    message.includes('indent'),
    `FAIL(4b): the error should tell the author to indent the line, got ${JSON.stringify(message)}`,
  );
}

// 4c — a column-0 fenced example with no real sibling region IS the region:
// replaced in place, fence lines and surrounding prose survive
{
  const content = [
    'Some prose.',
    '',
    '```markdown',
    '<ignatius-index scope="fake">',
    '',
    'fenced content, not a real region',
    '',
    '</ignatius-index>',
    '```',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'real' }, 'real content');
  assert(replaced.includes('Some prose.'), 'FAIL(4c): surrounding prose must survive');
  assert(replaced.includes('```markdown') && replaced.includes('```\n'), 'FAIL(4c): the fence lines must survive');
  assert(
    !replaced.includes('fenced content, not a real region'),
    'FAIL(4c): the column-0 pair inside the fence IS the region, so its old content must not survive',
  );
  assert(
    readRegion(replaced, 'ignatius-index') === 'real content',
    'FAIL(4c): the region must be replaced in place, not appended a second time',
  );
}

// 5 — CRLF input
{
  const content = '# Heading\r\n\r\n<ignatius-index scope="a">\r\n\r\n| A |\r\n\r\n</ignatius-index>\r\n\r\nTail.\r\n';
  assert(
    readRegion(content, 'ignatius-index') === '| A |',
    `FAIL(5): readRegion should handle CRLF, got ${JSON.stringify(readRegion(content, 'ignatius-index'))}`,
  );

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'a' }, '| B |');
  assert(
    readRegion(replaced, 'ignatius-index') === '| B |',
    'FAIL(5): replaceRegion should handle CRLF input',
  );
  assert(
    replaced.includes('Tail.'),
    'FAIL(5): CRLF replace should preserve trailing content',
  );
  assert(
    !/(?<!\r)\n/.test(replaced),
    `FAIL(5): replaceRegion must not introduce bare LF into a CRLF file, got ${JSON.stringify(replaced)}`,
  );
}

// 6 — a hand-authored <ignatius-rules> block survives a replace of a
// different region, byte for byte
{
  const rulesBlock = '<ignatius-rules>\n\n- money columns are decimal, never float\n\n</ignatius-rules>';
  const content = [
    '<ignatius-index scope="a">',
    '',
    'old',
    '',
    '</ignatius-index>',
    '',
    rulesBlock,
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'new');
  assert(
    replaced.includes(rulesBlock),
    'FAIL(6): the hand-authored rules block must survive byte for byte',
  );
}

// 7 — replace is idempotent, and preserves pre-existing hand-authored prose
{
  const content = '# Heading\n\nProse.\n';
  const once = replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'row');
  const twice = replaceRegion(once, 'ignatius-index', { scope: 'a' }, 'row');
  assert(once === twice, 'FAIL(7): applying the same content twice should be byte-identical');
  assert(
    once.includes('# Heading') && once.includes('Prose.'),
    'FAIL(7): appending onto a hand-authored file must preserve its existing prose',
  );
}

// 8 — nested same-name regions throw rather than silently dropping content
{
  const content = [
    '<ignatius-index scope="a">',
    '',
    'outer-start',
    '<ignatius-index scope="b">',
    '',
    'inner',
    '',
    '</ignatius-index>',
    '',
    'outer-end',
    '',
    '</ignatius-index>',
    '',
  ].join('\n');

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'SAFE');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(8): nested same-name regions must throw instead of destroying content');
}

// 9 — an orphaned/unclosed opening tag throws rather than being treated as
// appendable
{
  const content = '# Heading\n\n<ignatius-index scope="a">\n\npartial write, never closed\n';

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'new content');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(9): an unclosed opening tag must throw instead of being appended past');
}

// 10 — two regions sharing the same name throw rather than orphaning one
{
  const content = [
    '<ignatius-index scope="a">',
    '',
    'first',
    '',
    '</ignatius-index>',
    '',
    '<ignatius-index scope="b">',
    '',
    'second',
    '',
    '</ignatius-index>',
    '',
  ].join('\n');

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'replacement');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(10): duplicate same-name regions must throw rather than silently pick one');
}

// 11 — a wrapped (multi-line) opening tag attribute list still parses
{
  const content = [
    '<ignatius-index scope="entity-group" path="data/identity" count="8" depth="2"',
    '                digest="sha256:4f2ac19">',
    '',
    '| A |',
    '|---|',
    '| 1 |',
    '',
    '</ignatius-index>',
    '',
  ].join('\n');

  assert(
    readRegion(content, 'ignatius-index') === '| A |\n|---|\n| 1 |',
    `FAIL(11): readRegion should parse a wrapped opening tag, got ${JSON.stringify(readRegion(content, 'ignatius-index'))}`,
  );
}

// missing file gets a region appended; blank lines around the inner content
// are always present, per CommonMark's raw-HTML-block rule
{
  const created = replaceRegion('', 'ignatius-index', { scope: 'a' }, 'row');
  assert(
    created.includes('<ignatius-index scope="a">\n\nrow\n\n</ignatius-index>'),
    `FAIL: region on an empty file must carry the required blank lines, got ${JSON.stringify(created)}`,
  );
}

// 12 — a tight, hand-authored <ignatius-rules> block (no interior blank
// lines) survives an <ignatius-index> append rather than being reported as
// an unclosed opening tag
{
  const content = [
    '# Heading',
    '',
    'Prose.',
    '',
    '<ignatius-rules>',
    'my rules',
    '</ignatius-rules>',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  assert(
    replaced.includes('my rules') && replaced.includes('# Heading'),
    'FAIL(12): a tight hand-authored region must survive an unrelated append',
  );
  assert(
    readRegion(replaced, 'ignatius-index') === 'ROWS',
    'FAIL(12): the new region should be appended',
  );
}

// 13 — a tight region of the same name being replaced also works
{
  const content = [
    '<ignatius-index scope="a">',
    'first',
    '</ignatius-index>',
    '',
  ].join('\n');

  assert(
    readRegion(content, 'ignatius-index') === 'first',
    `FAIL(13): readRegion should parse a tight region, got ${JSON.stringify(readRegion(content, 'ignatius-index'))}`,
  );

  const replaced = replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'second');
  assert(
    readRegion(replaced, 'ignatius-index') === 'second',
    'FAIL(13): replaceRegion should swap a tight region in place',
  );
}

// 14 — a hand-authored `↑ ...` line above a region-less index survives
// writeRouters verbatim (SC8: bytes outside every region survive)
{
  const dir = resolve(import.meta.dir, '../../tmp/fixtures/router-region-crumb-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/externals`, { recursive: true });
  writeFileSync(
    `${dir}/externals/index.md`,
    '↑ hand-authored back link\n\n# Externals\n\nHand-authored prose.\n',
  );

  const file: RouterFile = {
    relPath: 'externals/index.md',
    breadcrumb: '↑ [Model](../index.md)',
    attrs: { scope: 'externals', path: 'externals', count: '0', depth: '1', digest: 'sha256:empty' },
    table: '| Name | Kind | Description | Go |\n|---|---|---|---|',
    digest: 'sha256:empty',
  };

  await writeRouters(dir, [file]);
  const written = readFileSync(`${dir}/externals/index.md`, 'utf8');
  assert(
    written.includes('↑ hand-authored back link'),
    `FAIL(14): hand-authored ↑ line must survive verbatim, got ${JSON.stringify(written)}`,
  );
  assert(
    written.includes('Hand-authored prose.'),
    'FAIL(14): hand-authored prose must survive verbatim',
  );
  // SC8: hand-authored bytes always survive, so the old crumb is never
  // stripped; the <ignatius-breadcrumb> region is generator-owned and gets
  // inserted regardless, so both breadcrumbs coexist by design.
  assert(
    written.includes('<ignatius-breadcrumb>') && written.includes('↑ [Model](../index.md)'),
    `FAIL(14): the generator-owned breadcrumb region must still be inserted, got ${JSON.stringify(written)}`,
  );
  rmSync(dir, { recursive: true, force: true });
}

// 15 — an <ignatius-*> tag name mentioned mid-line is text, not a boundary:
// this holds for any mid-line mention, backticks included, since position —
// not delimiters — is what makes a line a region boundary
{
  const content = [
    '<ignatius-rules>',
    '',
    'never edit the `<ignatius-index>` block',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  assert(
    replaced.includes('never edit the `<ignatius-index>` block'),
    'FAIL(15): the hand-authored rules block must survive untouched',
  );
  assert(
    readRegion(replaced, 'ignatius-index') === 'ROWS',
    'FAIL(15): the new region should be appended',
  );
}

// 15b — genuine nested/unclosed/duplicate cases still throw with inline
// code present elsewhere in the file
{
  const content = [
    'See the `<ignatius-rules>` tag name mentioned in code.',
    '',
    '<ignatius-index scope="a">',
    '',
    'outer-start',
    '<ignatius-index scope="b">',
    '',
    'inner',
    '',
    '</ignatius-index>',
    '',
    'outer-end',
    '',
    '</ignatius-index>',
    '',
  ].join('\n');

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'SAFE');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(15b): a genuinely nested same-name region must still throw');
}

// 15c — a line starting with a backtick is text, whatever it contains; the
// stray second column-0 closer below is what makes this file throw
{
  const content = [
    '<ignatius-index scope="a">',
    '',
    'outer',
    '`<ignatius-index scope="b"`>',
    'inner',
    '</ignatius-index>',
    'outer-end',
    '</ignatius-index>',
    '',
  ].join('\n');

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'SAFE');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(15c): a second column-0 closer must still throw even with a backtick-led line nearby');
}

// 16 — a one-space-indented and a tab-indented <ignatius-index> tag inside
// rules are text, not boundaries: no throw, bytes survive
{
  const content = [
    '<ignatius-rules>',
    '',
    ' <ignatius-index>',
    '\t<ignatius-index>',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');

  const replaced = replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  assert(
    replaced.includes(' <ignatius-index>') && replaced.includes('\t<ignatius-index>'),
    'FAIL(16): indented tag mentions inside rules must survive verbatim',
  );
  assert(
    readRegion(replaced, 'ignatius-index') === 'ROWS',
    'FAIL(16): the new region should be appended',
  );
}

// 17 — an orphan closer alone throws
{
  const content = ['# Heading', '', '</ignatius-index>', ''].join('\n');
  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', {}, 'ROWS');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(17): an orphan closing tag with nothing open must throw');
}

// 18 — a mismatched closer throws, naming both tags
{
  const content = ['<ignatius-index scope="a">', '', 'rows', '', '</ignatius-rules>', ''].join('\n');
  let message = '';
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'new');
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(
    message.includes('ignatius-index') && message.includes('ignatius-rules'),
    `FAIL(18): a mismatched closer must name both tags, got ${JSON.stringify(message)}`,
  );
}

// 19 — a whole column-0 tag inside inline code, plus a second closer, throws
// (this used to silently truncate the file)
{
  const content = [
    '<ignatius-index scope="a">',
    '',
    '`<ignatius-index scope="b">`',
    'inner',
    '</ignatius-index>',
    'outer-end',
    '</ignatius-index>',
    '',
  ].join('\n');

  let threw = false;
  try {
    replaceRegion(content, 'ignatius-index', { scope: 'a' }, 'SAFE');
  } catch {
    threw = true;
  }
  assert(threw, 'FAIL(19): a stray second column-0 closer must throw even when a whole tag sits in inline code');
}

// 20 — a tag pair with nothing but the line break between them: an empty
// region, not an unclosed one
{
  const content = '<ignatius-x>\n</ignatius-x>';
  assert(
    readRegion(content, 'ignatius-x') === '',
    `FAIL(20): readRegion should return an empty string for a back-to-back pair, got ${JSON.stringify(readRegion(content, 'ignatius-x'))}`,
  );
  const replaced = replaceRegion(content, 'ignatius-x', {}, 'new');
  assert(
    readRegion(replaced, 'ignatius-x') === 'new',
    'FAIL(20): replaceRegion must be able to replace a back-to-back pair',
  );
}

// 21 — every thrown message carries a 1-based line number, and the nested /
// orphan-closer messages carry the word "indent"
{
  const nestedContent = [
    '<ignatius-rules>',
    '',
    '<ignatius-index scope="a">',
    '',
    '</ignatius-rules>',
    '',
  ].join('\n');
  let nestedMessage = '';
  try {
    replaceRegion(nestedContent, 'ignatius-index', { scope: 'a' }, 'x');
  } catch (e) {
    nestedMessage = e instanceof Error ? e.message : String(e);
  }
  assert(/line \d+/.test(nestedMessage), `FAIL(21): nested message must carry a line number, got ${JSON.stringify(nestedMessage)}`);
  assert(nestedMessage.includes('indent'), `FAIL(21): nested message must mention indenting, got ${JSON.stringify(nestedMessage)}`);

  const orphanContent = ['# H', '', '</ignatius-index>', ''].join('\n');
  let orphanMessage = '';
  try {
    replaceRegion(orphanContent, 'ignatius-index', {}, 'x');
  } catch (e) {
    orphanMessage = e instanceof Error ? e.message : String(e);
  }
  assert(/line \d+/.test(orphanMessage), `FAIL(21): orphan-closer message must carry a line number, got ${JSON.stringify(orphanMessage)}`);
  assert(orphanMessage.includes('indent'), `FAIL(21): orphan-closer message must mention indenting, got ${JSON.stringify(orphanMessage)}`);

  const mismatchContent = ['<ignatius-index scope="a">', '', 'x', '', '</ignatius-rules>', ''].join('\n');
  let mismatchMessage = '';
  try {
    replaceRegion(mismatchContent, 'ignatius-index', { scope: 'a' }, 'x');
  } catch (e) {
    mismatchMessage = e instanceof Error ? e.message : String(e);
  }
  assert(/line \d+/.test(mismatchMessage), `FAIL(21): mismatch message must carry a line number, got ${JSON.stringify(mismatchMessage)}`);

  const unclosedContent = ['<ignatius-index scope="a">', '', 'x', ''].join('\n');
  let unclosedMessage = '';
  try {
    replaceRegion(unclosedContent, 'ignatius-index', { scope: 'a' }, 'x');
  } catch (e) {
    unclosedMessage = e instanceof Error ? e.message : String(e);
  }
  assert(/line \d+/.test(unclosedMessage), `FAIL(21): unclosed message must carry a line number, got ${JSON.stringify(unclosedMessage)}`);

  const duplicateContent = [
    '<ignatius-index scope="a">',
    '',
    'first',
    '',
    '</ignatius-index>',
    '',
    '<ignatius-index scope="b">',
    '',
    'second',
    '',
    '</ignatius-index>',
    '',
  ].join('\n');
  let duplicateMessage = '';
  try {
    replaceRegion(duplicateContent, 'ignatius-index', { scope: 'a' }, 'x');
  } catch (e) {
    duplicateMessage = e instanceof Error ? e.message : String(e);
  }
  assert(/lines \d+ and \d+/.test(duplicateMessage), `FAIL(21): duplicate message must carry both line numbers, got ${JSON.stringify(duplicateMessage)}`);
}

console.log('test-router-region: OK');
