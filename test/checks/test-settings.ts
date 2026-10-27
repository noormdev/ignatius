/** test-settings.ts — a corrupt or hand-edited `ignatius-settings` value never breaks the viewer; each bad field falls back alone. */

import { DEFAULT_SETTINGS, parseSettings, SETTINGS_STORAGE_KEY } from '../../src/app/logic/settings';
import type { Settings } from '../../src/app/logic/settings';
import { assert } from '../assert';

function same(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const defaults: Settings = { alwaysOpenExamples: false };
assert(same(DEFAULT_SETTINGS, defaults), `FAIL: DEFAULT_SETTINGS keeps examples on the <= 3 rule (got ${JSON.stringify(DEFAULT_SETTINGS)})`);
assert(SETTINGS_STORAGE_KEY === 'ignatius-settings', `FAIL: settings live under ignatius-settings (got ${SETTINGS_STORAGE_KEY})`);

const cases: Array<[string, string | null, Settings]> = [
  ['a first visit (no key)', null, defaults],
  ['invalid JSON', '{not json', defaults],
  ['a non-object (number)', '42', defaults],
  ['a non-object (array)', '[true]', defaults],
  ['JSON null', 'null', defaults],
  ['a wrong-typed field', '{"alwaysOpenExamples":"yes"}', defaults],
  ['a valid value', '{"alwaysOpenExamples":true}', { alwaysOpenExamples: true }],
  ['an unknown extra field', '{"alwaysOpenExamples":true,"later":1}', { alwaysOpenExamples: true }],
];

for (const [label, raw, expected] of cases) {
  const got = parseSettings(raw);
  assert(same(got, expected), `FAIL: parseSettings for ${label} → ${JSON.stringify(expected)} (got ${JSON.stringify(got)})`);
}

const fresh = parseSettings(null);
fresh.alwaysOpenExamples = true;
assert(DEFAULT_SETTINGS.alwaysOpenExamples === false, 'FAIL: mutating a parsed result leaves DEFAULT_SETTINGS untouched');

console.log(process.exitCode ? '\nsettings: failures above.' : '\nAll settings checks passed.');
