/**
 * test-parse-examples.ts — verifies examples pass-through in parser.
 *
 * Two assertions via parseModels against a tiny tmp fixture:
 *   1. Entity with examples: block of 2+ rows → ModelNode.examples is the array of row objects.
 *   2. Entity with NO examples field → ModelNode.examples is undefined (not [], not present).
 *
 * Fixture written to tmp/test-parse-examples/ and left in place (tmp/ is gitignored).
 */

import { parseModels } from '../../src/model/parse';
import { rmSync, mkdirSync, existsSync } from 'node:fs';

const TMP = 'tmp/test-parse-examples';

// Hard assert: a failure must abort the script with a non-zero exit so the
// `bun run test` loop (and CI) actually gates on it. console.assert does NOT
// exit non-zero in Bun, so it cannot be used here.
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Build fixture dir
// ---------------------------------------------------------------------------

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(`${TMP}/_groups`, { recursive: true });

// ignatius.yml — minimal
await Bun.write(`${TMP}/ignatius.yml`, 'name: test-parse-examples\n');

// Entity WITH examples: two rows
await Bun.write(`${TMP}/product.md`, `---
entity: Product
pk:
  - product_id
columns:
  product_id:
    type: uuid
  name:
    type: text
  price:
    type: numeric
examples:
  - product_id: "a1b2c3"
    name: "Widget Pro"
    price: 29.99
  - product_id: "d4e5f6"
    name: "Gadget Lite"
    price: 9.99
---
`);

// Entity WITHOUT examples
await Bun.write(`${TMP}/category.md`, `---
entity: Category
pk:
  - category_id
columns:
  category_id:
    type: uuid
  label:
    type: text
---
`);

const { model } = await parseModels(TMP);

// ---------------------------------------------------------------------------
// Assertion 1: entity WITH examples → ModelNode.examples is the array
// ---------------------------------------------------------------------------

const product = model.nodes.find(n => n.id === 'Product');
assert(product !== undefined, 'FAIL: Product node not found');
assert(
  product.examples !== undefined,
  'FAIL: Product.examples should be defined but got undefined',
);
assert(
  Array.isArray(product.examples),
  `FAIL: Product.examples should be an array, got ${typeof product.examples}`,
);
assert(
  product.examples.length === 2,
  `FAIL: Product.examples should have 2 rows, got ${product.examples.length}`,
);
const row0 = product.examples[0];
const row1 = product.examples[1];
assert(row0 !== undefined, 'FAIL: Product.examples[0] missing');
assert(row1 !== undefined, 'FAIL: Product.examples[1] missing');
assert(
  row0['name'] === 'Widget Pro',
  `FAIL: Product.examples[0].name should be "Widget Pro", got "${row0['name']}"`,
);
assert(
  row1['price'] === 9.99,
  `FAIL: Product.examples[1].price should be 9.99, got "${row1['price']}"`,
);
console.log('PASS: entity with examples: block → ModelNode.examples is the array of row objects');

// ---------------------------------------------------------------------------
// Assertion 2: entity WITHOUT examples → ModelNode.examples is undefined
// ---------------------------------------------------------------------------

const category = model.nodes.find(n => n.id === 'Category');
assert(category !== undefined, 'FAIL: Category node not found');
assert(
  category.examples === undefined,
  `FAIL: Category.examples should be undefined but got ${JSON.stringify(category.examples)}`,
);
assert(
  !('examples' in category),
  'FAIL: Category node should not have an "examples" key at all',
);
console.log('PASS: entity without examples field → ModelNode.examples is undefined and key absent');

console.log('\nAll parse-examples tests passed.');
