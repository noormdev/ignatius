/**
 * test-open-browser.ts — unit tests for the platform → browser-open argv map.
 *
 * Pins the command used by `serve --open` per OS so a refactor can't silently
 * break browser launch on one platform.
 */

import { browserOpenCommand } from '../../src/cli/open-browser';

function assertEq(actual: string[], expected: string[], msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error('FAIL:', msg, '\n  expected', JSON.stringify(expected), '\n  got     ', JSON.stringify(actual));
    process.exit(1);
  }
}

const URL = 'http://localhost:3000';

assertEq(browserOpenCommand('darwin', URL), ['open', URL], 'macOS uses `open`');
assertEq(browserOpenCommand('win32', URL), ['cmd', '/c', 'start', '', URL], 'Windows uses `cmd /c start`');
assertEq(browserOpenCommand('linux', URL), ['xdg-open', URL], 'Linux uses `xdg-open`');
// Unknown platforms fall back to the freedesktop opener rather than throwing.
assertEq(browserOpenCommand('freebsd', URL), ['xdg-open', URL], 'unknown platform falls back to xdg-open');

console.log('PASS: browserOpenCommand maps every platform');
