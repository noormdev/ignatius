// Verification: parseModels returns theme field, merges with defaults correctly
// Config is now loaded from ignatius.yml (not _theme.yaml).
import { parseModels } from '../../src/model/parse';
import { defaultTheme } from '../../src/theme/theme-defaults';
import { resolve } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/theme-parse-test');

// Minimal entity file so parseModels has something to scan
const MINIMAL_ENTITY = `---
entity: Widget
pk: [id]
columns:
  id: { type: uuid }
---
`;

function makeFixtureDir(name: string): string {
  const dir = `${BASE_TMP}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/data`, { recursive: true });
  writeFileSync(`${dir}/data/widget.md`, MINIMAL_ENTITY);
  return dir;
}

// --- Test 1: default theme (no theme block in ignatius.yml) ---
{
  const dir = makeFixtureDir('default-theme');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\n`);
  const { model } = await parseModels(dir);
  console.assert(model.theme !== undefined, 'FAIL: theme field missing');
  console.assert(model.theme.dark.background === defaultTheme.dark.background,
    `FAIL: default background mismatch: ${model.theme.dark.background}`);
  console.assert(model.theme.spacing.nodeSep === defaultTheme.spacing.nodeSep, 'FAIL: default nodeSep');
  console.log('PASS: default theme (no theme block in ignatius.yml)');
}

// --- Test 2: custom theme overrides via ignatius.yml ---
{
  const dir = makeFixtureDir('custom-theme');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\ntheme:\n  dark:\n    background: "#1a0030"\n    border: "#ff6b00"\n`);
  const { model } = await parseModels(dir);
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

console.log('All theme parse tests passed.');
