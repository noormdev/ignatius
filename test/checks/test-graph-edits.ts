/**
 * test-graph-edits.ts — undo/redo over graph arrangement snapshots.
 *
 * A snapshot is where every node sits plus which nodes are hidden. The
 * history exists so an accidental drag, hide, or re-layout can be taken back.
 *
 * Coverage:
 *   1. Undo returns the state before the last change and hands the current
 *      state to redo; redo returns it.
 *   2. A new change after an undo drops the redo branch.
 *   3. Undo and redo on an empty side return null.
 *   4. The history keeps only the newest `limit` changes.
 *   5. discardLast drops the newest undo step without making it redoable.
 *   6. L cycles organic → hierarchical → tree; unknown stored modes read as organic.
 */

import { createEditHistory, nextLayoutMode, parseLayoutMode } from '../../src/app/views/graph/graph-edits';
import type { GraphSnapshot } from '../../src/app/views/graph/graph-edits';
import { assert } from '../assert';

function snap(x: number, hidden: string[] = []): GraphSnapshot {
  return { positions: { A: { x, y: 0 } }, hidden, mode: 'hierarchical' };
}

// 1. undo then redo.
{
  const history = createEditHistory();
  history.push(snap(0));                       // before dragging A to 10
  const undone = history.undo(snap(10));
  assert(undone?.positions['A']?.x === 0, `FAIL 1a: undo should return x=0, got ${JSON.stringify(undone)}`);
  assert(history.canRedo(), 'FAIL 1b: redo available after undo');
  const redone = history.redo(snap(0));
  assert(redone?.positions['A']?.x === 10, `FAIL 1c: redo should return x=10, got ${JSON.stringify(redone)}`);
  assert(history.canUndo() && !history.canRedo(), 'FAIL 1d: after redo, undo available and redo empty');
}

// 2. a new change clears redo.
{
  const history = createEditHistory();
  history.push(snap(0));
  history.undo(snap(10));
  history.push(snap(0, ['A']));                // hide A instead
  assert(!history.canRedo(), 'FAIL 2: a new change after undo should drop the redo branch');
}

// 3. empty sides.
{
  const history = createEditHistory();
  assert(history.undo(snap(0)) === null, 'FAIL 3a: undo on empty history should be null');
  assert(history.redo(snap(0)) === null, 'FAIL 3b: redo on empty history should be null');
  assert(!history.canUndo() && !history.canRedo(), 'FAIL 3c: nothing to undo or redo');
}

// 4. limit.
{
  const history = createEditHistory(3);
  for (let i = 0; i < 5; i++) history.push(snap(i));
  let steps = 0;
  let current = snap(5);
  for (let back = history.undo(current); back; back = history.undo(current)) {
    current = back;
    steps++;
  }
  assert(steps === 3, `FAIL 4a: expected 3 undo steps, got ${steps}`);
  assert(current.positions['A']?.x === 2, `FAIL 4b: oldest kept state should be x=2, got ${current.positions['A']?.x}`);
}

// 5. discardLast: a relayout cancelled before it landed leaves no undo step.
{
  const history = createEditHistory();
  history.push(snap(0));                       // a real drag
  history.push(snap(1));                       // the relayout's pre-state
  history.discardLast();
  const undone = history.undo(snap(1));
  assert(undone?.positions['A']?.x === 0, `FAIL 5a: undo should reach the drag's pre-state, got ${JSON.stringify(undone)}`);
  assert(!history.canUndo(), 'FAIL 5b: the discarded step is gone');
  assert(!createEditHistory().canRedo(), 'FAIL 5c: fresh history has nothing to redo');
}

// 6. Layout modes: L steps organic → hierarchical → tree → organic; an unknown
//    stored value falls back to organic.
{
  assert(nextLayoutMode('organic') === 'hierarchical', 'FAIL 6a: organic → hierarchical');
  assert(nextLayoutMode('hierarchical') === 'tree', 'FAIL 6b: hierarchical → tree');
  assert(nextLayoutMode('tree') === 'organic', 'FAIL 6c: tree → organic');
  assert(parseLayoutMode('tree') === 'tree', 'FAIL 6d: stored tree is kept');
  assert(parseLayoutMode('sideways') === 'organic' && parseLayoutMode(null) === 'organic', 'FAIL 6e: unknown → organic');
}

if (process.exitCode !== 1) console.log('PASS: test-graph-edits');
