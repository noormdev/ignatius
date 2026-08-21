/**
 * test-json-value.ts — verifies the recognition and formatting rules behind
 * structured (`json`) example cells.
 *
 * Assertions:
 *   1. isJsonType accepts json/jsonb, case- and whitespace-insensitively.
 *   2. isJsonType rejects the scalar types and undefined.
 *   3. Nested objects and arrays are recognised regardless of declared type —
 *      this is the path YAML frontmatter actually takes.
 *   4. A JSON string is parsed only when the column is declared json.
 *   5. Scalars, and strings that merely look structured, stay text.
 *   6. A string that starts like JSON but does not parse stays text.
 *   7. Preview is compact single-line JSON, clipped to the budget with an
 *      ellipsis, and never exceeds it.
 *   8. Full form is pretty-printed with 2-space indent.
 *   9. describeJson reports key/item counts and singularises correctly.
 *  10. A circular structure degrades instead of throwing — the render path has
 *      no way to recover from an exception thrown inside a table cell.
 */

import {
  asJsonValue,
  describeJson,
  formatJsonFull,
  formatJsonPreview,
  isJsonType,
} from '../../src/app/logic/json-value';
import { assert } from '../assert';

// 1 — accepted type spellings
for (const t of ['json', 'JSON', 'jsonb', ' Json ']) {
  assert(isJsonType(t), `FAIL(1): isJsonType should accept ${JSON.stringify(t)}`);
}

// 2 — rejected type spellings
for (const t of ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'binary', 'jsonish']) {
  assert(!isJsonType(t), `FAIL(2): isJsonType should reject ${JSON.stringify(t)}`);
}
assert(!isJsonType(undefined), 'FAIL(2): isJsonType should reject undefined');

// 3 — nested values win on any column type
assert(
  asJsonValue({ theme: 'dark' }, 'text') !== null,
  'FAIL(3): a nested object should be recognised even on a text column',
);
assert(
  asJsonValue(['a', 'b'], undefined) !== null,
  'FAIL(3): a nested array should be recognised with no declared type',
);

// 4 — strings parse only under a json column
assert(
  asJsonValue('{"a":1}', 'json') !== null,
  'FAIL(4): a JSON string on a json column should parse',
);
assert(
  asJsonValue('{"a":1}', 'text') === null,
  'FAIL(4): a JSON string on a text column should stay text',
);
assert(
  asJsonValue('[1,2]', 'jsonb') !== null,
  'FAIL(4): a JSON array string on a jsonb column should parse',
);

// 5 — scalars and non-structured strings stay text
for (const raw of [1, true, 'hello', '', null, undefined]) {
  assert(
    asJsonValue(raw, 'json') === null,
    `FAIL(5): ${JSON.stringify(raw)} should not be treated as structured`,
  );
}
assert(
  asJsonValue('42', 'json') === null,
  'FAIL(5): a bare number string is not worth an expander',
);
assert(
  asJsonValue('"quoted"', 'json') === null,
  'FAIL(5): a bare JSON string scalar is not worth an expander',
);

// 6 — malformed input degrades to text rather than throwing
assert(
  asJsonValue('{not valid json', 'json') === null,
  'FAIL(6): an unparseable brace-leading string should stay text',
);

// 7 — preview clipping
const wide = { alpha: 'one', beta: 'two', gamma: 'three', delta: 'four', epsilon: 'five' };
const preview = formatJsonPreview(wide, 20);
assert(preview.length <= 20, `FAIL(7): preview exceeded budget: ${preview.length} > 20`);
assert(preview.endsWith('…'), `FAIL(7): clipped preview should end in an ellipsis, got ${preview}`);
assert(!preview.includes('\n'), 'FAIL(7): preview should be single-line');

const small = { a: 1 };
assert(
  formatJsonPreview(small, 20) === '{"a":1}',
  'FAIL(7): a value inside the budget should render whole and unclipped',
);

// 8 — full form is pretty-printed
const full = formatJsonFull({ a: { b: 1 } });
assert(full.includes('\n'), 'FAIL(8): full form should be multi-line');
assert(full.includes('  "a"'), `FAIL(8): full form should use 2-space indent, got:\n${full}`);

// 9 — shape summary
assert(describeJson({ a: 1, b: 2 }) === '2 keys', 'FAIL(9): expected "2 keys"');
assert(describeJson({ a: 1 }) === '1 key', 'FAIL(9): expected singular "1 key"');
assert(describeJson([1, 2, 3]) === '3 items', 'FAIL(9): expected "3 items"');
assert(describeJson(['only']) === '1 item', 'FAIL(9): expected singular "1 item"');
assert(describeJson([]) === '0 items', 'FAIL(9): expected "0 items"');

// 10 — a self-referential value must not throw out of a table cell. YAML
// anchors can alias back into an ancestor node, so this is reachable from a
// model file, not just from hand-built objects.
const circular: Record<string, unknown> = { name: 'loop' };
circular['self'] = circular;
let threw = false;
try {
  formatJsonPreview(circular);
  formatJsonFull(circular);
} catch {
  threw = true;
}
assert(!threw, 'FAIL(10): formatting a circular value should degrade, not throw');

console.log('test-json-value: OK');
