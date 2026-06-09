/**
 * test-titlelize.ts — unit tests for the titlelize helper.
 *
 * titlelize converts slugs/folder-names/ids into human-readable Title Case strings.
 * Distinct from wrapEntityLabel: this produces a flat string (no newlines),
 * splitting on hyphens, underscores, camelCase, acronym, and digit boundaries.
 */

import { titlelize } from '../../src/titlelize';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Hyphens → spaces, Title Case each word
assert(titlelize('order-to-cash') === 'Order To Cash', `order-to-cash → "Order To Cash" (got "${titlelize('order-to-cash')}")`);
assert(titlelize('refund') === 'Refund', `refund → "Refund" (got "${titlelize('refund')}")`);
assert(titlelize('order-management') === 'Order Management', `order-management → "Order Management" (got "${titlelize('order-management')}")`);
console.log('PASS: hyphens');

// Underscores → spaces, Title Case
assert(titlelize('order_to_cash') === 'Order To Cash', `order_to_cash → "Order To Cash" (got "${titlelize('order_to_cash')}")`);
assert(titlelize('create_sales_order') === 'Create Sales Order', `create_sales_order → "Create Sales Order" (got "${titlelize('create_sales_order')}")`);
console.log('PASS: underscores');

// Mixed hyphens/underscores
assert(titlelize('order-to_cash') === 'Order To Cash', `order-to_cash → "Order To Cash" (got "${titlelize('order-to_cash')}")`);
console.log('PASS: mixed separators');

// PascalCase with hyphens (already capitalized)
assert(titlelize('Create-Sales-Order') === 'Create Sales Order', `Create-Sales-Order → "Create Sales Order" (got "${titlelize('Create-Sales-Order')}")`);
console.log('PASS: PascalCase with hyphens');

// camelCase splitting
assert(titlelize('orderToCash') === 'Order To Cash', `orderToCash → "Order To Cash" (got "${titlelize('orderToCash')}")`);
assert(titlelize('createSalesOrder') === 'Create Sales Order', `createSalesOrder → "Create Sales Order" (got "${titlelize('createSalesOrder')}")`);
console.log('PASS: camelCase');

// PascalCase splitting
assert(titlelize('OrderToCash') === 'Order To Cash', `OrderToCash → "Order To Cash" (got "${titlelize('OrderToCash')}")`);
assert(titlelize('CreateSalesOrder') === 'Create Sales Order', `CreateSalesOrder → "Create Sales Order" (got "${titlelize('CreateSalesOrder')}")`);
console.log('PASS: PascalCase');

// Acronym boundary (ACRONYM→Word)
assert(titlelize('HTTPRequest') === 'HTTP Request', `HTTPRequest → "HTTP Request" (got "${titlelize('HTTPRequest')}")`);
assert(titlelize('parseHTTPResponse') === 'Parse HTTP Response', `parseHTTPResponse → "Parse HTTP Response" (got "${titlelize('parseHTTPResponse')}")`);
console.log('PASS: acronym boundary');

// Digit boundaries
assert(titlelize('order2cash') === 'Order 2 Cash', `order2cash → "Order 2 Cash" (got "${titlelize('order2cash')}")`);
assert(titlelize('phase1') === 'Phase 1', `phase1 → "Phase 1" (got "${titlelize('phase1')}")`);
console.log('PASS: digit boundaries');

// No characters lost — assert exact output for digit and acronym cases.
// These prove specific boundary splits work without silently dropping characters.
assert(titlelize('order2cash') === 'Order 2 Cash', `digit boundary: order2cash → "Order 2 Cash" (got "${titlelize('order2cash')}")`);
assert(titlelize('HTTPRequest') === 'HTTP Request', `acronym boundary: HTTPRequest → "HTTP Request" (got "${titlelize('HTTPRequest')}")`);
// The '2' digit must appear as its own word (not merged or dropped):
assert(titlelize('order2cash').split(' ').includes('2'), `digit "2" is its own word in "order2cash" (got "${titlelize('order2cash')}")`);
// All letters of the acronym must survive:
assert(titlelize('HTTPRequest').startsWith('HTTP'), `"HTTP" preserved in full in "HTTPRequest" (got "${titlelize('HTTPRequest')}")`);
// Full invariant: no characters lost (collapse check as a backstop)
const cases = ['order-to-cash', 'Create-Sales-Order', 'HTTPRequest', 'order2cash', 'createSalesOrder'];
for (const s of cases) {
  const raw = s.replace(/[-_]/g, '').toLowerCase();
  const titled = titlelize(s).replace(/\s/g, '').toLowerCase();
  assert(titled === raw, `no characters lost for "${s}" (raw="${raw}", titled="${titled}")`);
}
console.log('PASS: no characters lost (digit + acronym + invariant)');

// Single word
assert(titlelize('refund') === 'Refund', `single word "refund" → "Refund"`);
assert(titlelize('Order') === 'Order', `already titled "Order" → "Order"`);
console.log('PASS: single words');

// Empty string
assert(titlelize('') === '', `empty string → empty string`);
console.log('PASS: empty string');

console.log('\nAll titlelize assertions passed.');
