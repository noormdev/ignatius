/**
 * Tests for branding markup in generateDict output.
 * Run against unmodified dict.ts to confirm failures, then green after implementation.
 */
import { generateDict } from '../../src/generators/dict';
import { defaultBranding, mergeBranding } from '../../src/branding-defaults';
import { parseModels } from '../../src/parse';

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Use a real parsed model so theme/groups/nodes are valid
const baseModel = await parseModels('models/key-inherited');

// Override branding with defaults explicitly
const defaultModel = { ...baseModel, branding: defaultBranding };

// ── Test 1: Default branding embeds data URI logo ─────────────────────────────
const darkHtml = await generateDict(defaultModel, 'dark', { modelsDir: 'models/key-inherited' });
assert(
  darkHtml.includes('data:image/svg+xml;base64,'),
  'Default dark: output contains embedded data URI logo',
);

const lightHtml = await generateDict(defaultModel, 'light', { modelsDir: 'models/key-inherited' });
assert(
  lightHtml.includes('data:image/svg+xml;base64,'),
  'Default light: output contains embedded data URI logo',
);

// ── Test 2: poweredBy: true renders noorm.dev link (default — no explicit flag needed) ──
const poweredByModel = { ...baseModel, branding: mergeBranding({}) };
const poweredByHtml = await generateDict(poweredByModel, 'dark', { modelsDir: 'models/key-inherited' });
assert(
  poweredByHtml.includes('href="https://noorm.dev"'),
  'poweredBy:true includes <a href="https://noorm.dev">',
);

// ── Test 3: poweredBy: false omits noorm.dev link ─────────────────────────────
const noPowerModel = { ...baseModel, branding: mergeBranding({ poweredBy: false }) };
const noPowerHtml = await generateDict(noPowerModel, 'dark', { modelsDir: 'models/key-inherited' });
assert(
  !noPowerHtml.includes('noorm.dev'),
  'poweredBy:false has NO noorm.dev link',
);

// ── Test 4: Custom title appears verbatim ─────────────────────────────────────
const customModel = {
  ...baseModel,
  branding: mergeBranding({ title: 'Acme Schema', subtitle: 'Your data mapped' }),
};
const customHtml = await generateDict(customModel, 'dark', { modelsDir: 'models/key-inherited' });
assert(
  customHtml.includes('Acme Schema'),
  'Custom title "Acme Schema" appears in output',
);

// ── Test 5: Custom subtitle appears verbatim ──────────────────────────────────
assert(
  customHtml.includes('Your data mapped'),
  'Custom subtitle "Your data mapped" appears in output',
);

// ── Test 6: Footer copyright shows holder and year ───────────────────────────
const holderModel = {
  ...baseModel,
  branding: mergeBranding({
    copyright: { holder: 'Widgets Inc', year: 2024 },
    poweredBy: false,
  }),
};
const holderHtml = await generateDict(holderModel, 'dark', { modelsDir: 'models/key-inherited' });
assert(
  holderHtml.includes('Widgets Inc'),
  'Footer contains custom copyright holder',
);
assert(
  holderHtml.includes('2024'),
  'Footer contains custom copyright year',
);

// ── Test 7: Logo img tag with data URI present ────────────────────────────────
assert(
  darkHtml.includes('<img ') && darkHtml.includes('data:image/svg+xml;base64,'),
  'Logo img tag with data URI present',
);

// ── Test 8: Branding and footer structural blocks present ─────────────────────
assert(
  darkHtml.includes('dict-branding'),
  'dict-branding header block present',
);
assert(
  darkHtml.includes('dict-footer'),
  'dict-footer block present',
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll 9 branding assertions passed.`);
}
