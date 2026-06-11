/**
 * test-wrap-label.ts — unit tests for graph node label wrapping.
 *
 * Verifies long entity names break onto multiple lines at word boundaries while
 * short names stay untouched — the behaviour that keeps graph nodes compact.
 */

import { wrapEntityLabel } from '../../src/app/views/graph/wrap-label';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Short names: returned unchanged (underscores spaced).
assert(wrapEntityLabel('Party') === 'Party', 'short name unchanged');
assert(wrapEntityLabel('OrderItem') === 'OrderItem', 'name at/under threshold unchanged');
assert(wrapEntityLabel('ProductGroup') === 'ProductGroup', '12 chars unchanged');
assert(wrapEntityLabel('SI_Line') === 'SI Line', 'underscores become spaces');
console.log('PASS: short names');

// Long PascalCase: break at word boundaries, no characters lost.
assert(wrapEntityLabel('MenuItemBranchEvent') === 'MenuItem\nBranchEvent', 'two-line camel break');
assert(wrapEntityLabel('ModifierAllowedInstruction') === 'Modifier\nAllowed\nInstruction', 'three-line camel break');
assert(wrapEntityLabel('ProductGroupMember') === 'ProductGroup\nMember', 'breaks at last fitting boundary');
console.log('PASS: long camelCase wrapping');

// Acronyms and digits are break opportunities; no characters are dropped.
assert(wrapEntityLabel('HTTPRequestHandler') === 'HTTPRequest\nHandler', 'acronym boundary');
for (const name of ['MenuItemBranchEvent', 'ModifierAllowedInstruction', 'HTTPRequestHandler', 'some_long_snake_case_name']) {
  const collapsed = wrapEntityLabel(name).replace(/\n/g, '').replace(/ /g, '');
  const original = name.replace(/_/g, '');
  assert(collapsed === original, `no characters lost for ${name} (got "${collapsed}")`);
}
console.log('PASS: no characters lost when wrapping');

// A single long word with no break opportunity stays on one line.
assert(wrapEntityLabel('Supercalifragilistic') === 'Supercalifragilistic', 'unbreakable word stays one line');
console.log('PASS: unbreakable single word');

console.log('\nAll wrap-label assertions passed.');
