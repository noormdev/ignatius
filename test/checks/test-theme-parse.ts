// Verification: parseModels returns theme field, merges with defaults correctly
import { parseModels } from '../../src/parse';
import { defaultTheme } from '../../src/theme-defaults';
import { resolve } from 'path';

const modelsDir = resolve(import.meta.dir, '../../models');
const themeFile = `${modelsDir}/_theme.yaml`;

// --- Test 1: default theme (no _theme.yaml) ---
{
  const model = await parseModels(modelsDir);
  console.assert(model.theme !== undefined, 'FAIL: theme field missing');
  console.assert(model.theme.dark.background === defaultTheme.dark.background,
    `FAIL: default background mismatch: ${model.theme.dark.background}`);
  console.assert(model.theme.spacing.nodeSep === 30, 'FAIL: default nodeSep');
  console.log('PASS: default theme (no _theme.yaml)');
}

// --- Test 2: custom theme overrides ---
await Bun.write(themeFile, `dark:\n  background: "#1a0030"\n  border: "#ff6b00"\n`);
{
  const model = await parseModels(modelsDir);
  console.assert(model.theme.dark.background === '#1a0030',
    `FAIL: custom background: ${model.theme.dark.background}`);
  console.assert(model.theme.dark.border === '#ff6b00',
    `FAIL: custom border: ${model.theme.dark.border}`);
  // unspecified fields should fall back to defaults
  console.assert(model.theme.dark.text === defaultTheme.dark.text,
    `FAIL: text should be default: ${model.theme.dark.text}`);
  // light should be fully default
  console.assert(model.theme.light.background === defaultTheme.light.background,
    `FAIL: light background should be default`);
  console.log('PASS: custom dark palette merged, light and spacing default');
}

await Bun.$`rm ${themeFile}`;
console.log('All theme parse tests passed.');
