// Verification: parseModels returns branding field, merges with defaults correctly
import { parseModels } from '../../src/parse';
import { defaultBranding } from '../../src/branding-defaults';
import { resolve } from 'path';

const modelsDir = resolve(import.meta.dir, '../../models');
const brandingFile = `${modelsDir}/_branding.yaml`;

// Ensure no leftover branding file from a previous run
const bf = Bun.file(brandingFile);
if (await bf.exists()) await Bun.$`rm ${brandingFile}`;

// --- Test 1: defaults when no _branding.yaml ---
{
  const model = await parseModels(modelsDir);
  console.assert(model.branding !== undefined, 'FAIL: branding field missing');
  console.assert(model.branding.title === defaultBranding.title,
    `FAIL: default title: ${model.branding.title}`);
  console.assert(model.branding.subtitle === defaultBranding.subtitle,
    `FAIL: default subtitle: ${model.branding.subtitle}`);
  console.assert(model.branding.poweredBy === true, 'FAIL: default poweredBy should be true');
  console.assert(model.branding.logo.dark.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.dark should be a data URI, got: ${model.branding.logo.dark.slice(0, 60)}`);
  console.assert(model.branding.logo.light.startsWith('data:image/svg+xml;base64,'), `FAIL: default logo.light should be a data URI, got: ${model.branding.logo.light.slice(0, 60)}`);
  console.log('PASS: defaults when no _branding.yaml');
}

// --- Test 2: custom file end-to-end ---
await Bun.write(brandingFile, `title: "Acme Schema"\nsubtitle: "Internal data"\nlogo: "./assets/logo.svg"\ncopyright:\n  holder: "Acme Corp"\n  year: 2025\npoweredBy: false\n`);
{
  const model = await parseModels(modelsDir);
  console.assert(model.branding.title === 'Acme Schema',
    `FAIL: custom title: ${model.branding.title}`);
  console.assert(model.branding.subtitle === 'Internal data',
    `FAIL: custom subtitle: ${model.branding.subtitle}`);
  console.assert(model.branding.poweredBy === false, 'FAIL: custom poweredBy should be false');
  console.assert(model.branding.copyright.holder === 'Acme Corp',
    `FAIL: copyright holder: ${model.branding.copyright.holder}`);
  console.assert(model.branding.copyright.year === 2025,
    `FAIL: copyright year: ${model.branding.copyright.year}`);
  console.log('PASS: custom file end-to-end');
}

// --- Test 3: string shorthand expansion ---
await Bun.write(brandingFile, `logo: "./icon.svg"\n`);
{
  const model = await parseModels(modelsDir);
  console.assert(model.branding.logo.dark === './icon.svg',
    `FAIL: shorthand dark: ${model.branding.logo.dark}`);
  console.assert(model.branding.logo.light === './icon.svg',
    `FAIL: shorthand light: ${model.branding.logo.light}`);
  console.log('PASS: string shorthand expansion');
}

// --- Test 4: object form with one missing key falls back to the present one ---
await Bun.write(brandingFile, `logo:\n  dark: "./logo-dark.svg"\n`);
{
  const model = await parseModels(modelsDir);
  console.assert(model.branding.logo.dark === './logo-dark.svg',
    `FAIL: object.dark: ${model.branding.logo.dark}`);
  console.assert(model.branding.logo.light === './logo-dark.svg',
    `FAIL: object missing light should fallback to dark: ${model.branding.logo.light}`);
  console.log('PASS: object form with one missing key falls back to the present one');
}

// --- Test 5: title >50 chars throws ---
const longTitle = 'A'.repeat(51);
await Bun.write(brandingFile, `title: "${longTitle}"\n`);
{
  let threw = false;
  try {
    await parseModels(modelsDir);
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
const longSubtitle = 'B'.repeat(51);
await Bun.write(brandingFile, `subtitle: "${longSubtitle}"\n`);
{
  let threw = false;
  try {
    await parseModels(modelsDir);
  } catch (e: unknown) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    console.assert(msg.includes('subtitle'), `FAIL: error should mention 'subtitle': ${msg}`);
    console.assert(msg.includes('character') || msg.includes('length'), `FAIL: error should mention characters/length: ${msg}`);
  }
  console.assert(threw, 'FAIL: subtitle >50 should throw');
  console.log('PASS: subtitle >50 chars throws');
}

// Cleanup
await Bun.$`rm ${brandingFile}`;
console.log('All branding parse tests passed.');
