/**
 * test-motion.ts — hover intent and the animation cutoff (src/app/logic/motion.ts).
 *
 * Why it matters: on a large model a hover focus restyles hundreds of
 * elements. A pointer sweeping across the canvas must trigger none of that,
 * a pointer that rests must trigger exactly one, and moving between two
 * elements must switch focus in one step rather than clear and re-fade.
 */

import { assert } from '../assert';
import { ANIMATION_ELEMENT_LIMIT, HOVER_INTENT_MS, animationsAllowed, createHoverIntent } from '../../src/app/logic/motion';

const DELAY = 200;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function recorder() {
  const applied: Array<string | null> = [];
  const intent = createHoverIntent(target => applied.push(target), DELAY);
  return { applied, intent };
}

assert(HOVER_INTENT_MS === 300, `FAIL: hover intent delay is ${HOVER_INTENT_MS}ms, expected 300ms`);
assert(ANIMATION_ELEMENT_LIMIT === 150, `FAIL: animation limit is ${ANIMATION_ELEMENT_LIMIT}, expected 150`);
assert(animationsAllowed(150) && !animationsAllowed(151), 'FAIL: the limit is inclusive: 150 animates, 151 does not');
console.log('PASS: 300 ms hover delay; animations stop above 150 rendered elements');

// A sweep across several elements applies nothing, then the resting one once.
{
  const { applied, intent } = recorder();
  for (const id of ['a', 'b', 'c', 'd']) {
    intent.set(id);
    await sleep(DELAY / 4);
  }
  assert(applied.length === 0, `FAIL: a sweep applied ${JSON.stringify(applied)} before settling`);
  await sleep(DELAY * 2);
  assert(JSON.stringify(applied) === '["d"]', `FAIL: expected only the resting target, got ${JSON.stringify(applied)}`);
  console.log('PASS: sweeping applies nothing; resting applies the final target once');
}

// Pointer moves inside one element keep reporting it; the wait never restarts.
{
  const { applied, intent } = recorder();
  intent.set('edge');
  for (let i = 0; i < 6; i++) {
    await sleep(DELAY / 4);
    intent.set('edge');
  }
  assert(JSON.stringify(applied) === '["edge"]', `FAIL: repeated reports of one target should settle once, got ${JSON.stringify(applied)}`);
  console.log('PASS: repeated reports of the same target do not restart the wait');
}

// A → B switches in one step: no null in between, even across an empty gap.
{
  const { applied, intent } = recorder();
  intent.set('a');
  await sleep(DELAY * 2);
  intent.set(null); // pointer crosses empty canvas
  await sleep(DELAY / 4);
  intent.set('b');
  await sleep(DELAY * 2);
  assert(JSON.stringify(applied) === '["a","b"]', `FAIL: expected a then b with no clear, got ${JSON.stringify(applied)}`);
  console.log('PASS: moving between elements switches focus without an intermediate clear');
}

// Leaving and coming back inside the wait keeps the focus and applies nothing.
{
  const { applied, intent } = recorder();
  intent.set('a');
  await sleep(DELAY * 2);
  intent.set(null);
  await sleep(DELAY / 4);
  intent.set('a');
  await sleep(DELAY * 2);
  assert(JSON.stringify(applied) === '["a"]', `FAIL: returning to the focused target should change nothing, got ${JSON.stringify(applied)}`);
  console.log('PASS: returning to the focused element before the wait ends keeps its focus');
}

// Leaving to empty space clears only after resting there.
{
  const { applied, intent } = recorder();
  intent.set('a');
  await sleep(DELAY * 2);
  intent.set(null);
  await sleep(DELAY * 2);
  assert(JSON.stringify(applied) === '["a",null]', `FAIL: expected a then clear, got ${JSON.stringify(applied)}`);
  console.log('PASS: resting on empty space clears the focus');
}

// applyNow skips the wait (Shift, dialogs); cancel drops a pending target.
{
  const { applied, intent } = recorder();
  intent.set('a');
  intent.applyNow('b');
  assert(JSON.stringify(applied) === '["b"]' && intent.applied() === 'b', `FAIL: applyNow should apply at once, got ${JSON.stringify(applied)}`);
  await sleep(DELAY * 2);
  assert(applied.length === 1, `FAIL: applyNow must drop the pending target, got ${JSON.stringify(applied)}`);
  intent.set('c');
  intent.cancel();
  await sleep(DELAY * 2);
  assert(applied.length === 1 && intent.applied() === 'b', 'FAIL: cancel must drop the pending target and keep the applied one');
  console.log('PASS: applyNow applies immediately; cancel drops the pending target');
}

console.log('\nAll motion tests passed.');
