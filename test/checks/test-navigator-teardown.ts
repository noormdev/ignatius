/**
 * test-navigator-teardown.ts — regression guard for the navigator 'resize'-leak crash.
 *
 * Crash: switching views / reloading the model intermittently threw
 *   "Cannot read properties of null (reading 'isHeadless')"
 *   at Core.headless ← boundingBox ← Navigator.resize ← _checkThumbnailSizesAndUpdate.
 *
 * Root cause (verified in node_modules/cytoscape-navigator/cytoscape-navigator.js):
 * the plugin's destroy() (≈:355) calls ONLY _removeEventsHandling() — overlay +
 * window listeners — and NEVER _removeCyListeners() (≈:323). _removeCyListeners is
 * what unsubscribes the cy listeners the navigator added, including the cy 'resize'
 * listener (added ≈:391) and cy.offRender(this._onRenderHandler). So after
 * nav.destroy() the 'resize' listener is still attached to the cy; a trailing cy
 * 'resize' (e.g. one emitted while cy.destroy() runs) then fires Navigator.resize →
 * boundingBox on a core whose _private is already null → reads 'isHeadless' of null.
 *
 * Fix: teardownNavigator calls nav._removeCyListeners?.() BEFORE nav.destroy(), while
 * the cy is still alive (GraphView destroys the cy only AFTER teardownNavigator). This
 * test pins the contract WITHOUT a real browser/cy: order matters (listeners must come
 * off while cy is alive) and the optional-chaining guards must tolerate an older/
 * defensive nav shape that lacks _removeCyListeners / _onRenderHandler.
 */
import { teardownNavigator } from '../../src/app/views/graph/navigator';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// 1. Full nav shape: order is recorded so we can prove _removeCyListeners runs first.
const calls: string[] = [];
const fullNav = {
  destroy: () => {
    calls.push('destroy');
  },
  _onRenderHandler: {
    cancel: () => {
      calls.push('cancel');
    },
  },
  _removeCyListeners: () => {
    calls.push('removeCyListeners');
  },
};

teardownNavigator(fullNav, null);

assert(calls.includes('removeCyListeners'), '_removeCyListeners must be called');
assert(calls.includes('destroy'), 'destroy must be called');
assert(calls.includes('cancel'), '_onRenderHandler.cancel must be called');

const removeIdx = calls.indexOf('removeCyListeners');
const destroyIdx = calls.indexOf('destroy');
assert(
  removeIdx < destroyIdx,
  `_removeCyListeners must be called BEFORE destroy (cy must still be alive when listeners come off); got order: ${calls.join(' → ')}`,
);
console.log('PASS: teardownNavigator removes cy listeners before destroy, and cancels the render handler');

// 2. Defensive/older nav shape: _removeCyListeners and _onRenderHandler ABSENT.
//    The optional-chaining guards must not throw; destroy must still run.
let bareDestroyed = false;
let threw = false;
try {
  teardownNavigator({ destroy: () => { bareDestroyed = true; } }, null);
} catch (err) {
  threw = true;
  console.error('  threw:', err);
}
assert(!threw, 'teardownNavigator must not throw when _removeCyListeners/_onRenderHandler are absent');
assert(bareDestroyed, 'destroy must still run on the bare nav shape');
console.log('PASS: teardownNavigator tolerates an older/defensive nav with no _removeCyListeners or _onRenderHandler');

console.log('\nAll navigator-teardown assertions passed.');
