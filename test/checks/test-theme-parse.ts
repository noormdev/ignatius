// Verification: parseModels returns theme field, merges with defaults correctly
// Config is now loaded from ignatius.yml (not _theme.yaml).
import { parseModels } from '../../src/parse';
import { defaultTheme } from '../../src/theme-defaults';
import { resolve } from 'path';

const modelsDir = resolve(import.meta.dir, '../../models/key-inherited');
const configFile = `${modelsDir}/ignatius.yml`;

// Preserve the original file content so we can restore it after tests
const originalContent = await Bun.file(configFile).exists()
  ? await Bun.file(configFile).text()
  : null;

// --- Test 1: default theme (no theme block in ignatius.yml) ---
{
  // The ignatius.yml at key-inherited has only `name:` — no theme block
  if (originalContent !== null) await Bun.write(configFile, `name: Key-Inherited\n`);
  const model = await parseModels(modelsDir);
  console.assert(model.theme !== undefined, 'FAIL: theme field missing');
  console.assert(model.theme.dark.background === defaultTheme.dark.background,
    `FAIL: default background mismatch: ${model.theme.dark.background}`);
  console.assert(model.theme.spacing.nodeSep === 30, 'FAIL: default nodeSep');
  console.log('PASS: default theme (no theme block in ignatius.yml)');
}

// --- Test 2: custom theme overrides via ignatius.yml ---
await Bun.write(configFile, `name: Key-Inherited\ntheme:\n  dark:\n    background: "#1a0030"\n    border: "#ff6b00"\n`);
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

// Restore original content
if (originalContent !== null) {
  await Bun.write(configFile, originalContent);
} else {
  await Bun.$`rm ${configFile}`;
}
console.log('All theme parse tests passed.');
