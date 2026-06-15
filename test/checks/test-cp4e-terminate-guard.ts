/**
 * test-cp4e-terminate-guard.ts — regression guard for CP-4e.
 *
 * ELK's `terminateWorker()` throws in the browser bundle (`this.worker.terminate
 * is not a function` — the main-thread web-worker shim has no real worker). If
 * that exception escapes `computeElkLayout`, `FlowsView.renderDiagram` treats the
 * (actually successful) ELK layout as a failure and silently falls back to the
 * banded positioner + hand-routed edges. That regression shipped undetected
 * because unit tests run in Bun, where `terminateWorker()` works — only the
 * browser path throws.
 *
 * `terminateQuietly` must invoke `terminateWorker()` (so Bun frees its worker)
 * but never propagate an error (so the browser keeps the good layout). This test
 * pins both behaviours; it fails if the try/catch guard is removed.
 */
import { terminateQuietly } from '../../src/flow-view/elk-flow-layout';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// 1. A throwing terminateWorker (the browser case) must NOT propagate.
let throwingCalled = false;
let threw = false;
try {
  terminateQuietly({
    terminateWorker: () => {
      throwingCalled = true;
      throw new TypeError('this.worker.terminate is not a function');
    },
  });
} catch {
  threw = true;
}
assert(throwingCalled, 'terminateQuietly must invoke terminateWorker()');
assert(!threw, 'terminateQuietly must SWALLOW a throwing terminateWorker (the browser regression)');
console.log('PASS: terminateQuietly swallows a throwing terminateWorker (browser path)');

// 2. On the happy path (Bun real worker) it must still call terminateWorker exactly once.
let count = 0;
terminateQuietly({ terminateWorker: () => { count += 1; } });
assert(count === 1, `terminateQuietly must call terminateWorker once on the happy path, got ${count}`);
console.log('PASS: terminateQuietly invokes terminateWorker once on the happy path (Bun)');

console.log('\nAll CP-4e terminate-guard assertions passed.');
