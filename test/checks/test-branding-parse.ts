// Verification: parseModels returns branding field, merges with defaults correctly
// Config is now loaded from ignatius.yml (not _branding.yaml).
import { parseModels } from '../../src/model/parse';
import { defaultBranding } from '../../src/theme/branding-defaults';
import { resolve } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/branding-parse-test');

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
  mkdirSync(dir, { recursive: true });
  mkdirSync(`${dir}/_groups`, { recursive: true });
  writeFileSync(`${dir}/widget.md`, MINIMAL_ENTITY);
  return dir;
}

// --- Test 1: defaults when no branding block in ignatius.yml ---
{
  const dir = makeFixtureDir('defaults');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\n`);
  const { model } = await parseModels(dir);
  console.assert(model.branding !== undefined, 'FAIL: branding field missing');
  console.assert(model.branding.title === defaultBranding.title,
    `FAIL: default title: ${model.branding.title}`);
  console.assert(model.branding.subtitle === defaultBranding.subtitle,
    `FAIL: default subtitle: ${model.branding.subtitle}`);
  console.assert(model.branding.poweredBy === true, 'FAIL: default poweredBy should be true');
  console.assert(model.branding.logo.dark.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.dark should be a data URI, got: ${model.branding.logo.dark.slice(0, 60)}`);
  console.assert(model.branding.logo.light.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.light should be a data URI, got: ${model.branding.logo.light.slice(0, 60)}`);
  console.log('PASS: defaults when no branding block in ignatius.yml');
}

// --- Test 2: custom branding block end-to-end ---
{
  const dir = makeFixtureDir('custom');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  title: "Acme Schema"\n  subtitle: "Internal data"\n  logo: "./assets/logo.svg"\n  copyright:\n    holder: "Acme Corp"\n    year: 2025\n  poweredBy: false\n`);
  const { model } = await parseModels(dir);
  console.assert(model.branding.title === 'Acme Schema',
    `FAIL: custom title: ${model.branding.title}`);
  console.assert(model.branding.subtitle === 'Internal data',
    `FAIL: custom subtitle: ${model.branding.subtitle}`);
  console.assert(model.branding.poweredBy === false, 'FAIL: custom poweredBy should be false');
  console.assert(model.branding.copyright.holder === 'Acme Corp',
    `FAIL: copyright holder: ${model.branding.copyright.holder}`);
  console.assert(model.branding.copyright.year === 2025,
    `FAIL: copyright year: ${model.branding.copyright.year}`);
  console.log('PASS: custom branding block end-to-end');
}

// --- Test 3: string shorthand expansion ---
{
  const dir = makeFixtureDir('shorthand');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  logo: "./icon.svg"\n`);
  const { model } = await parseModels(dir);
  console.assert(model.branding.logo.dark === './icon.svg',
    `FAIL: shorthand dark: ${model.branding.logo.dark}`);
  console.assert(model.branding.logo.light === './icon.svg',
    `FAIL: shorthand light: ${model.branding.logo.light}`);
  console.log('PASS: string shorthand expansion');
}

// --- Test 4: object form with one missing key falls back to the present one ---
{
  const dir = makeFixtureDir('logo-object');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  logo:\n    dark: "./logo-dark.svg"\n`);
  const { model } = await parseModels(dir);
  console.assert(model.branding.logo.dark === './logo-dark.svg',
    `FAIL: object.dark: ${model.branding.logo.dark}`);
  console.assert(model.branding.logo.light === './logo-dark.svg',
    `FAIL: object missing light should fallback to dark: ${model.branding.logo.light}`);
  console.log('PASS: object form with one missing key falls back to the present one');
}

// --- Test 5: title >50 chars throws ---
{
  const dir = makeFixtureDir('long-title');
  const longTitle = 'A'.repeat(51);
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  title: "${longTitle}"\n`);
  let threw = false;
  try {
    await parseModels(dir);
  } catch (e: unknown) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    console.assert(msg.includes('title'), `FAIL: error should mention 'title': ${msg}`);
    console.assert(msg.includes('character') || msg.includes('length'), `FAIL: error should mention characters/length: ${msg}`);
  }
  console.assert(threw, 'FAIL: title >50 should throw');
  console.log('PASS: title >50 chars throws');
}

// --- Test 6: subtitle >50 chars throws ---
{
  const dir = makeFixtureDir('long-subtitle');
  const longSubtitle = 'B'.repeat(51);
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  subtitle: "${longSubtitle}"\n`);
  let threw = false;
  try {
    await parseModels(dir);
  } catch (e: unknown) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    console.assert(msg.includes('subtitle'), `FAIL: error should mention 'subtitle': ${msg}`);
    console.assert(msg.includes('character') || msg.includes('length'), `FAIL: error should mention characters/length: ${msg}`);
  }
  console.assert(threw, 'FAIL: subtitle >50 should throw');
  console.log('PASS: subtitle >50 chars throws');
}

console.log('All branding parse tests passed.');
