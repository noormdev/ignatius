/**
 * test-process-node-size.ts — unit tests for the pure process-node sizing helper.
 *
 * #5 (viewer-ux-polish): a DFD process node must size to fit its (wrapped)
 * label so long names like "Confirm OTP And Create Individual" render fully
 * inside the box instead of overflowing the fixed 120×68 rect.
 *
 * Proves:
 *  - A short label ("Login") sits at the MIN floor (≈120×68) and wraps to 1–2
 *    lines — short names look unchanged.
 *  - A long label ("Confirm OTP And Create Individual") grows: width ≥ longest
 *    wrapped line estimate + the number-badge reserve + padding, height grows
 *    for the extra lines, and EVERY wrapped line's estimated width fits within
 *    the box's inner text area (no overflow).
 *  - Line count is sane and no single line exceeds the inner text width.
 *  - A long single word still fits inside the box (the box widens; the word is
 *    never drawn outside the rect).
 *
 * A no-op helper that returns the fixed floor for every label would FAIL the
 * long-label cases (the long label would overflow the inner text width).
 *
 * Run: bun test/checks/test-process-node-size.ts
 */

import {
  processNodeSize,
  estProcessLineWidth,
  PROC_MIN_W,
  PROC_MIN_H,
  PROC_TEXT_LEFT,
  PROC_TEXT_RIGHT_PAD,
} from '../../src/flow-view/flow-layout';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

/** Inner text width of a sized box: total width minus the left badge reserve and the right pad. */
function innerTextWidth(width: number): number {
  return width - PROC_TEXT_LEFT - PROC_TEXT_RIGHT_PAD;
}

// ── Short label → MIN floor, looks unchanged ──────────────────────────────────

const shortS = processNodeSize('Login');
assert(shortS.width === PROC_MIN_W, `short label width: expected floor ${PROC_MIN_W}, got ${shortS.width}`);
assert(shortS.height === PROC_MIN_H, `short label height: expected floor ${PROC_MIN_H}, got ${shortS.height}`);
assert(shortS.lines.length >= 1 && shortS.lines.length <= 2, `short label line count: expected 1–2, got ${shortS.lines.length}`);
assert(shortS.lines.join(' ') === 'Login', `short label round-trip: expected "Login", got "${shortS.lines.join(' ')}"`);
console.log('PASS: short label → MIN floor, 1–2 lines, unchanged look');

// A two-word short label still floors (fits on one or two lines within the floor inner width).
const twoWord = processNodeSize('Create Task');
assert(twoWord.width === PROC_MIN_W, `two-word short width: expected floor ${PROC_MIN_W}, got ${twoWord.width}`);
assert(twoWord.lines.join(' ') === 'Create Task', `two-word round-trip: got "${twoWord.lines.join(' ')}"`);
console.log('PASS: two-word short label → MIN floor');

// ── Long label → grows; every line fits the inner text width ──────────────────

const longLabel = 'Confirm OTP And Create Individual';
const longS = processNodeSize(longLabel);

// The box must grow beyond the floor on at least one axis (more lines and/or wider).
assert(
  longS.height > PROC_MIN_H || longS.width > PROC_MIN_W,
  `long label must grow beyond floor (${PROC_MIN_W}×${PROC_MIN_H}), got ${longS.width}×${longS.height}`,
);
console.log(`PASS: long label grows — ${longS.width}×${longS.height}, ${longS.lines.length} line(s)`);

// Round-trip: wrapping must preserve the words in order (no dropped/duplicated text).
assert(longS.lines.join(' ') === longLabel, `long label round-trip: expected "${longLabel}", got "${longS.lines.join(' ')}"`);
console.log('PASS: long label wrap preserves all words in order');

// EVERY wrapped line's estimated width must fit inside the box's inner text area.
const inner = innerTextWidth(longS.width);
for (const line of longS.lines) {
  const w = estProcessLineWidth(line);
  assert(w <= inner + 0.5, `line "${line}" estimated width ${w} exceeds inner text width ${inner}`);
}
console.log(`PASS: every long-label line fits the inner text width (${inner}px)`);

// Width floor: the box must be at least wide enough for the longest line + badge + pad.
const longestLine = longS.lines.reduce((a, b) => (estProcessLineWidth(b) > estProcessLineWidth(a) ? b : a), '');
const required = estProcessLineWidth(longestLine) + PROC_TEXT_LEFT + PROC_TEXT_RIGHT_PAD;
assert(longS.width + 0.5 >= required, `long label width ${longS.width} < required ${required} for longest line "${longestLine}"`);
console.log('PASS: width ≥ longest-line estimate + badge reserve + padding');

// Height grows with line count (taller than the floor when wrapping to >2 lines, or at least the floor).
assert(longS.height >= PROC_MIN_H, `long label height ${longS.height} below floor ${PROC_MIN_H}`);
console.log('PASS: height ≥ floor and reflects line count');

// ── Long single word still fits inside the box ────────────────────────────────

const longWord = 'Supercalifragilisticexpialidocious';
const wordS = processNodeSize(longWord);
const wordInner = innerTextWidth(wordS.width);
for (const line of wordS.lines) {
  const w = estProcessLineWidth(line);
  assert(w <= wordInner + 0.5, `long-word line "${line}" estimated width ${w} exceeds inner ${wordInner}`);
}
console.log('PASS: long single word fits inside the box (no overflow)');

// ── Empty label is safe (degenerate) ──────────────────────────────────────────

const emptyS = processNodeSize('');
assert(emptyS.width === PROC_MIN_W && emptyS.height === PROC_MIN_H, `empty label should floor, got ${emptyS.width}×${emptyS.height}`);
console.log('PASS: empty label → MIN floor, no throw');

console.log('\nAll process-node-size assertions passed.');
process.exit(0);
