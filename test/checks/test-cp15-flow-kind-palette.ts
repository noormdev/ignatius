/**
 * CP15 unit checks: mergeTheme + resolveFlowKindPalette behavior.
 *
 * Proves:
 *  - Default palette covers all 8 FlowKindKey values in both modes.
 *  - A partial theme.flowKinds override wins for the specified field without
 *    wiping sibling fields (bg overrides fg/border stays from default).
 *  - Unrelated kinds are unaffected by an override targeting a different kind.
 *  - `db` default matches today's store fill; `external` matches today's ext green.
 *  - `resolveFlowKindPalette(mode)` with no overrides returns defaultFlowKinds[mode].
 */

import { resolveFlowKindPalette, mergeTheme, defaultFlowKinds } from '../../src/theme-defaults';
import type { FlowKindKey } from '../../src/theme-defaults';

const pass = (label: string) => console.log(`PASS: ${label}`);
const fail = (label: string): never => { console.error(`FAIL: ${label}`); process.exit(1); };

function assert(cond: boolean, label: string): void {
  if (cond) pass(label);
  else fail(label);
}

// ── 1. All 8 kinds present in dark + light defaults ───────────────────────────

const allKinds: FlowKindKey[] = ['db', 'cache', 'queue', 'file', 'doc', 'manual', 'other', 'external'];

for (const mode of ['dark', 'light'] as const) {
  const palette = resolveFlowKindPalette(mode);
  for (const kind of allKinds) {
    assert(typeof palette[kind].bg === 'string' && palette[kind].bg.startsWith('#'),
      `${mode} "${kind}" has bg hex`);
    assert(typeof palette[kind].fg === 'string' && palette[kind].fg.startsWith('#'),
      `${mode} "${kind}" has fg hex`);
    assert(typeof palette[kind].border === 'string' && palette[kind].border.startsWith('#'),
      `${mode} "${kind}" has border hex`);
  }
}

// ── 2. `db` default matches today's store fill ────────────────────────────────

assert(defaultFlowKinds.dark.db.bg === '#3d2e00',
  'dark db.bg matches today\'s storeFill');
assert(defaultFlowKinds.light.db.bg === '#fef9c3',
  'light db.bg matches today\'s storeFill');

// ── 3. `external` default matches today's ext fill ───────────────────────────

assert(defaultFlowKinds.dark.external.bg === '#1a3a1a',
  'dark external.bg matches today\'s extFill');
assert(defaultFlowKinds.light.external.bg === '#dcfce7',
  'light external.bg matches today\'s extFill');

// ── 4. Partial override: a user bg wins, fg+border stay from default ──────────

const merged = mergeTheme({
  flowKinds: {
    cache: {
      dark: { bg: '#ff0000' },
    },
  },
});

const resolved = resolveFlowKindPalette('dark', merged.flowKinds);
assert(resolved.cache.bg === '#ff0000',
  'dark cache.bg overridden to #ff0000');
assert(resolved.cache.fg === defaultFlowKinds.dark.cache.fg,
  'dark cache.fg unchanged by bg-only override');
assert(resolved.cache.border === defaultFlowKinds.dark.cache.border,
  'dark cache.border unchanged by bg-only override');

// ── 5. Unrelated kind unaffected by override ──────────────────────────────────

assert(resolved.queue.bg === defaultFlowKinds.dark.queue.bg,
  'dark queue.bg unaffected by cache override');
assert(resolved.file.bg === defaultFlowKinds.dark.file.bg,
  'dark file.bg unaffected by cache override');

// ── 6. Override only affects target mode, not sibling ─────────────────────────

const resolvedLight = resolveFlowKindPalette('light', merged.flowKinds);
assert(resolvedLight.cache.bg === defaultFlowKinds.light.cache.bg,
  'light cache.bg unaffected by dark-only override');

// ── 7. No override → identical to defaults ────────────────────────────────────

const noOverride = resolveFlowKindPalette('dark', undefined);
assert(noOverride.file.bg === defaultFlowKinds.dark.file.bg,
  'no-override: dark file.bg equals default');

// ── 8. Colors are distinct across kinds (no accidental palette collision) ─────

const darkKinds = resolveFlowKindPalette('dark');
const darkBgs = allKinds.map(k => darkKinds[k].bg);
const darkUnique = new Set(darkBgs).size;
assert(darkUnique === allKinds.length,
  `all 8 dark bg values are distinct (got ${darkUnique})`);

const lightKinds = resolveFlowKindPalette('light');
const lightBgs = allKinds.map(k => lightKinds[k].bg);
const lightUnique = new Set(lightBgs).size;
assert(lightUnique === allKinds.length,
  `all 8 light bg values are distinct (got ${lightUnique})`);

console.log('\nAll CP15 flow-kind-palette checks passed.');
