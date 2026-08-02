// Verification: parseModels returns branding field, merges with defaults correctly
// Config is now loaded from ignatius.yml (not _branding.yaml).
import { assert } from '../assert';
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
  mkdirSync(`${dir}/data`, { recursive: true });
  writeFileSync(`${dir}/data/widget.md`, MINIMAL_ENTITY);
  return dir;
}

// --- Test 1: defaults when no branding block in ignatius.yml ---
{
  const dir = makeFixtureDir('defaults');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\n`);
  const { model } = await parseModels(dir);
  assert(model.branding !== undefined, 'FAIL: branding field missing');
  assert(model.branding.title === defaultBranding.title,
    `FAIL: default title: ${model.branding.title}`);
  assert(model.branding.subtitle === defaultBranding.subtitle,
    `FAIL: default subtitle: ${model.branding.subtitle}`);
  assert(model.branding.poweredBy === true, 'FAIL: default poweredBy should be true');
  assert(model.branding.logo.dark.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.dark should be a data URI, got: ${model.branding.logo.dark.slice(0, 60)}`);
  assert(model.branding.logo.light.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.light should be a data URI, got: ${model.branding.logo.light.slice(0, 60)}`);
  console.log('PASS: defaults when no branding block in ignatius.yml');
}

// --- Test 2: custom branding block end-to-end ---
{
  const dir = makeFixtureDir('custom');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  title: "Acme Schema"\n  subtitle: "Internal data"\n  logo: "./assets/logo.svg"\n  copyright:\n    holder: "Acme Corp"\n    year: 2025\n  poweredBy: false\n`);
  const { model } = await parseModels(dir);
  assert(model.branding.title === 'Acme Schema',
    `FAIL: custom title: ${model.branding.title}`);
  assert(model.branding.subtitle === 'Internal data',
    `FAIL: custom subtitle: ${model.branding.subtitle}`);
  assert(model.branding.poweredBy === false, 'FAIL: custom poweredBy should be false');
  assert(model.branding.copyright.holder === 'Acme Corp',
    `FAIL: copyright holder: ${model.branding.copyright.holder}`);
  assert(model.branding.copyright.year === 2025,
    `FAIL: copyright year: ${model.branding.copyright.year}`);
  console.log('PASS: custom branding block end-to-end');
}

// A logo distinguishable from the embedded noorm mark, so "the path resolved
// and was read" is provable rather than indistinguishable from the fallback.
const FIXTURE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const FIXTURE_SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(FIXTURE_SVG).toString('base64')}`;

// --- Test 3: string shorthand expansion ---
// Shorthand still expands one path into BOTH slots; parse then inlines each to
// a data URI (the model root is the only place a relative logo path resolves
// against, so the raw path never survives). Asserting the inlined value proves
// expansion AND that the file was actually found — a missing file silently
// yields the noorm default, which would pass a "both slots are equal" check.
{
  const dir = makeFixtureDir('shorthand');
  writeFileSync(`${dir}/icon.svg`, FIXTURE_SVG);
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  logo: "./icon.svg"\n`);
  const { model } = await parseModels(dir);
  assert(model.branding.logo.dark === FIXTURE_SVG_DATA_URI,
    `FAIL: shorthand dark: ${model.branding.logo.dark}`);
  assert(model.branding.logo.light === FIXTURE_SVG_DATA_URI,
    `FAIL: shorthand light: ${model.branding.logo.light}`);
  console.log('PASS: string shorthand expansion');
}

// --- Test 4: object form with one missing key falls back to the present one ---
{
  const dir = makeFixtureDir('logo-object');
  writeFileSync(`${dir}/logo-dark.svg`, FIXTURE_SVG);
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  logo:\n    dark: "./logo-dark.svg"\n`);
  const { model } = await parseModels(dir);
  assert(model.branding.logo.dark === FIXTURE_SVG_DATA_URI,
    `FAIL: object.dark: ${model.branding.logo.dark}`);
  assert(model.branding.logo.light === FIXTURE_SVG_DATA_URI,
    `FAIL: object missing light should fallback to dark: ${model.branding.logo.light}`);
  console.log('PASS: object form with one missing key falls back to the present one');
}

// --- Test 4b: a logo path that does not resolve falls back to the noorm mark ---
// The fallback is deliberate (a broken <img> in an exported file is worse than
// the wrong logo), so it needs a test of its own — otherwise Tests 3/4 above
// would still pass if inlining silently stopped resolving anything.
{
  const dir = makeFixtureDir('logo-missing');
  writeFileSync(`${dir}/ignatius.yml`, `name: Test Model\nbranding:\n  logo: "./nope.svg"\n`);
  const { model } = await parseModels(dir);
  assert(model.branding.logo.dark === defaultBranding.logo.dark,
    `FAIL: missing logo file should fall back to the default mark: ${model.branding.logo.dark.slice(0, 60)}`);
  assert(model.branding.logo.light === defaultBranding.logo.light,
    `FAIL: missing logo file light fallback: ${model.branding.logo.light.slice(0, 60)}`);
  console.log('PASS: unresolvable logo path falls back to the default mark');
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
    assert(msg.includes('title'), `FAIL: error should mention 'title': ${msg}`);
    assert(msg.includes('character') || msg.includes('length'), `FAIL: error should mention characters/length: ${msg}`);
  }
  assert(threw, 'FAIL: title >50 should throw');
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
    assert(msg.includes('subtitle'), `FAIL: error should mention 'subtitle': ${msg}`);
    assert(msg.includes('character') || msg.includes('length'), `FAIL: error should mention characters/length: ${msg}`);
  }
  assert(threw, 'FAIL: subtitle >50 should throw');
  console.log('PASS: subtitle >50 chars throws');
}

console.log('All branding parse tests passed.');
