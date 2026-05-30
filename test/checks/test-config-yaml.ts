// Verification: parseModels reads theme/branding/meta from ignatius.yml
// Covers: (a) full ignatius.yml, (b) only name: in ignatius.yml, (c) no ignatius.yml
import { parseModels } from '../../src/parse';
import { defaultTheme } from '../../src/theme-defaults';
import { defaultBranding } from '../../src/branding-defaults';
import { resolve } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/config-yaml-test');

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

// --- Test (a): full ignatius.yml with theme + branding + top-level meta ---
{
  const dir = makeFixtureDir('full');
  writeFileSync(`${dir}/ignatius.yml`, `\
name: Full Model
version: "1.0"
description: A complete config
updated: "2026-01-01"
theme:
  dark:
    background: "#1a0030"
    border: "#ff6b00"
branding:
  title: Custom Title
  subtitle: Custom Subtitle
  poweredBy: false
`);

  const { model } = await parseModels(dir);

  console.assert(model._meta !== undefined, 'FAIL (a): _meta should be defined');
  console.assert(model._meta?.name === 'Full Model', `FAIL (a): _meta.name = ${model._meta?.name}`);
  console.assert(model._meta?.version === '1.0', `FAIL (a): _meta.version = ${model._meta?.version}`);
  console.assert(model._meta?.desc === 'A complete config', `FAIL (a): _meta.desc = ${model._meta?.desc}`);
  console.assert(model._meta?.updated === '2026-01-01', `FAIL (a): _meta.updated = ${model._meta?.updated}`);
  console.assert(model.theme.dark.background === '#1a0030', `FAIL (a): theme.dark.background = ${model.theme.dark.background}`);
  console.assert(model.theme.dark.border === '#ff6b00', `FAIL (a): theme.dark.border = ${model.theme.dark.border}`);
  // unspecified theme fields fall back to defaults
  console.assert(model.theme.dark.text === defaultTheme.dark.text, `FAIL (a): theme.dark.text should be default, got ${model.theme.dark.text}`);
  console.assert(model.theme.light.background === defaultTheme.light.background, `FAIL (a): light should be default`);
  console.assert(model.branding.title === 'Custom Title', `FAIL (a): branding.title = ${model.branding.title}`);
  console.assert(model.branding.subtitle === 'Custom Subtitle', `FAIL (a): branding.subtitle = ${model.branding.subtitle}`);
  console.assert(model.branding.poweredBy === false, `FAIL (a): branding.poweredBy = ${model.branding.poweredBy}`);
  console.log('PASS (a): full ignatius.yml — theme + branding + meta loaded');
}

// --- Test (b): only name: in ignatius.yml — theme/branding default, _meta.name set ---
{
  const dir = makeFixtureDir('name-only');
  writeFileSync(`${dir}/ignatius.yml`, `name: Name-Only Model\n`);

  const { model } = await parseModels(dir);

  console.assert(model._meta !== undefined, 'FAIL (b): _meta should be defined');
  console.assert(model._meta?.name === 'Name-Only Model', `FAIL (b): _meta.name = ${model._meta?.name}`);
  console.assert(model._meta?.version === undefined, `FAIL (b): _meta.version should be undefined, got ${model._meta?.version}`);
  // theme and branding must equal defaults
  console.assert(model.theme.dark.background === defaultTheme.dark.background, `FAIL (b): theme should default, got ${model.theme.dark.background}`);
  console.assert(model.branding.title === defaultBranding.title, `FAIL (b): branding.title should default, got ${model.branding.title}`);
  console.assert(model.branding.poweredBy === true, `FAIL (b): branding.poweredBy should default true`);
  console.log('PASS (b): only name: in ignatius.yml — theme + branding default, _meta.name set');
}

// --- Test (c): no ignatius.yml — defaults, _meta undefined ---
{
  const dir = makeFixtureDir('no-config');
  // no ignatius.yml written

  const { model } = await parseModels(dir);

  console.assert(model._meta === undefined, `FAIL (c): _meta should be undefined, got ${JSON.stringify(model._meta)}`);
  console.assert(model.theme.dark.background === defaultTheme.dark.background, `FAIL (c): theme should default`);
  console.assert(model.branding.title === defaultBranding.title, `FAIL (c): branding should default`);
  console.log('PASS (c): no ignatius.yml — defaults, _meta undefined');
}

console.log('All ignatius.yml config load tests passed.');
