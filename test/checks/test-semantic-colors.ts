/**
 * Verifies that semanticColors is mode-aware (dark + light palettes present and correct).
 *
 * buildThemeCssVars was removed along with src/generators/theme-css.ts (orphaned after
 * the unified-app rework; the SPA applies theme at runtime via applyThemeCssVars).
 */
import { semanticColors } from '../../src/theme/theme-defaults';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failures++;
    } else {
        console.log(`PASS: ${msg}`);
    }
}

// --- semanticColors structure ---
assert(
    typeof semanticColors.dark === 'object',
    'semanticColors.dark exists',
);
assert(
    typeof semanticColors.light === 'object',
    'semanticColors.light exists',
);

// --- Dark values preserved ---
assert(
    semanticColors.dark.independent.bg === '#0d419d',
    `dark independent.bg is #0d419d, got: ${semanticColors.dark.independent.bg}`,
);
assert(
    semanticColors.dark.independent.fg === '#58a6ff',
    `dark independent.fg is #58a6ff, got: ${semanticColors.dark.independent.fg}`,
);
assert(
    semanticColors.dark.link === '#58a6ff',
    `dark link is #58a6ff, got: ${semanticColors.dark.link}`,
);

// --- Light values present ---
assert(
    semanticColors.light.independent.bg === '#ddf4ff',
    `light independent.bg is #ddf4ff, got: ${semanticColors.light.independent.bg}`,
);
assert(
    semanticColors.light.independent.fg === '#0550ae',
    `light independent.fg is #0550ae, got: ${semanticColors.light.independent.fg}`,
);
assert(
    semanticColors.light.dependent.bg === '#fff8c5',
    `light dependent.bg is #fff8c5, got: ${semanticColors.light.dependent.bg}`,
);
assert(
    semanticColors.light.dependent.fg === '#7d4e00',
    `light dependent.fg is #7d4e00, got: ${semanticColors.light.dependent.fg}`,
);
assert(
    semanticColors.light.subtype.bg === '#dafbe1',
    `light subtype.bg is #dafbe1, got: ${semanticColors.light.subtype.bg}`,
);
assert(
    semanticColors.light.link === '#0969da',
    `light link is #0969da, got: ${semanticColors.light.link}`,
);

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
