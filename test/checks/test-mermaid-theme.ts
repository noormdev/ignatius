/** test-mermaid-theme.ts — diagrams take the model's palette by default, `theme.mermaid.<mode>` overrides it,
 *  and a value that is not a string or number is dropped with a `config.mermaid_theme_invalid` finding. */

import { appendFileSync, cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultTheme, mergeTheme, SAFE_MERMAID_VALUE, semanticColors, type ThemeMode } from '../../src/theme/theme-defaults';
import { resolveMermaidThemeVariables } from '../../src/theme/mermaid-theme';
import { blendHex } from '../../src/app/logic/color';
import { parseModels } from '../../src/model/parse';
import { RULES, validateModel } from '../../src/model/validate';
import { assert } from '../assert';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

for (const mode of ['dark', 'light'] satisfies ThemeMode[]) {
  const p = defaultTheme[mode];
  const sc = semanticColors[mode];
  const vars = resolveMermaidThemeVariables(defaultTheme, mode);

  const table: Record<string, string> = {
    fontSize: '14px',
    background: p.background,
    primaryColor: p.surface,
    primaryBorderColor: blendHex(p.border, p.textMuted, 0.35),
    primaryTextColor: p.text,
    secondaryColor: blendHex(p.surface, p.background, 0.5),
    tertiaryColor: blendHex(p.surface, p.background, 0.5),
    lineColor: p.textMuted,
    textColor: p.text,
    noteBkgColor: sc.dependent.bg,
    noteTextColor: sc.dependent.fg,
    clusterBkg: p.background,
    clusterBorder: blendHex(p.border, p.textMuted, 0.35),
    edgeLabelBackground: p.surface,
  };
  for (const [key, want] of Object.entries(table)) {
    assert(vars[key] === want, `FAIL(${mode}): ${key} defaults to ${want}, got ${String(vars[key])}`);
  }
  assert(
    typeof vars['fontFamily'] === 'string' && vars['fontFamily'].includes('system-ui'),
    `FAIL(${mode}): fontFamily is the app's body stack, got ${String(vars['fontFamily'])}`,
  );

  const familyKeys = [
    'actorBkg', 'actorBorder', 'actorTextColor', 'signalColor', 'labelBoxBkgColor', 'noteBorderColor', 'activationBkgColor',
    'stateBkg', 'stateLabelColor', 'transitionColor', 'compositeBackground',
    'classText',
    'rowOdd', 'rowEven', 'attributeBackgroundColorOdd',
    'taskBkgColor', 'critBkgColor', 'activeTaskBkgColor', 'gridColor',
    'quadrant1Fill', 'quadrantPointFill',
    'xyChart',
    ...Array.from({ length: 12 }, (_, i) => `pie${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `git${i}`),
    ...Array.from({ length: 12 }, (_, i) => `cScale${i}`),
  ];
  for (const key of familyKeys) {
    assert(vars[key] !== undefined, `FAIL(${mode}): ${key} has a default`);
  }

  const badges = [sc.independent.bg, sc.dependent.bg, sc.classifier.bg, sc.subtype.bg, sc.associative.bg, sc.link];
  for (let i = 0; i < 12; i++) {
    const fill = badges[i % badges.length] ?? '';
    assert(vars[`cScale${i}`] === fill, `FAIL(${mode}): cScale${i} cycles the badge backgrounds (${fill}), got ${String(vars[`cScale${i}`])}`);
    assert(vars[`pie${i + 1}`] === fill, `FAIL(${mode}): pie${i + 1} cycles the badge backgrounds`);
    const label = vars[`cScaleLabel${i}`];
    const best = contrast(p.text, fill) >= contrast('#ffffff', fill) ? p.text : '#ffffff';
    assert(label === best, `FAIL(${mode}): cScaleLabel${i} on ${fill} is the higher-contrast of text and white (${best}), got ${String(label)}`);
  }
}

const overridden = mergeTheme({ mermaid: { dark: { primaryColor: '#123456', fontSize: 16 } } });
const darkVars = resolveMermaidThemeVariables(overridden, 'dark');
const lightVars = resolveMermaidThemeVariables(overridden, 'light');
assert(darkVars['primaryColor'] === '#123456', 'FAIL: theme.mermaid.dark overrides primaryColor');
assert(darkVars['fontSize'] === 16, 'FAIL: a number override is kept');
assert(darkVars['lineColor'] === defaultTheme.dark.textMuted, 'FAIL: an override leaves the other defaults alone');
assert(lightVars['primaryColor'] === defaultTheme.light.surface, 'FAIL: a dark override does not touch light');

const filtered = mergeTheme({ mermaid: { light: { ok: 'x', n: 2, obj: { a: 1 }, list: [1], flag: true, nil: null } } });
assert(
  JSON.stringify(filtered.mermaid) === JSON.stringify({ light: { ok: 'x', n: 2 } }),
  `FAIL: mergeTheme drops non-scalar values, got ${JSON.stringify(filtered.mermaid)}`,
);
assert(mergeTheme({ mermaid: 'blue' }).mermaid === undefined, 'FAIL: a non-object mermaid block is dropped');

const unsafe = mergeTheme({
  mermaid: {
    dark: {
      fontFamily: 'x;} svg { background: red',
      lineColor: 'url(https://example.com/x.png)',
      textColor: 'red; @import url(evil.css)',
      primaryColor: '#123456',
      titleColor: 'rgb(1, 2, 3)',
      noteTextColor: '"Segoe UI", sans-serif',
    },
  },
});
assert(
  JSON.stringify(unsafe.mermaid?.dark) === JSON.stringify({ primaryColor: '#123456', titleColor: 'rgb(1, 2, 3)', noteTextColor: '"Segoe UI", sans-serif' }),
  `FAIL: values with {, : or / are dropped and safe ones kept, got ${JSON.stringify(unsafe.mermaid?.dark)}`,
);
assert(
  JSON.stringify(unsafe.invalidMermaidKeys) === JSON.stringify(['theme.mermaid.dark.fontFamily', 'theme.mermaid.dark.lineColor', 'theme.mermaid.dark.textColor']),
  `FAIL: each dropped unsafe value is reported by key, got ${JSON.stringify(unsafe.invalidMermaidKeys)}`,
);
for (const mode of ['dark', 'light'] satisfies ThemeMode[]) {
  const unsafeDefaults = Object.entries(resolveMermaidThemeVariables(defaultTheme, mode))
    .filter(([, v]) => typeof v === 'string' && !SAFE_MERMAID_VALUE.test(v))
    .map(([k]) => k);
  assert(unsafeDefaults.length === 0, `FAIL(${mode}): every default passes the value pattern, not ${unsafeDefaults.join(', ')}`);
}

assert(RULES['config.mermaid_theme_invalid'].class === 'A', 'FAIL: config.mermaid_theme_invalid is a Tier A rule');

async function findingsFor(yml: string): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), 'ignatius-mermaid-theme-'));
  try {
    writeFileSync(join(root, 'ignatius.yml'), yml);
    const { model, globalErrors } = await parseModels(root);
    assert(
      !globalErrors.some(e => e.ruleId === 'config.mermaid_theme_invalid'),
      'FAIL: config.mermaid_theme_invalid is a warning, never a global error',
    );
    return validateModel(model).entityErrors
      .filter(e => e.ruleId === 'config.mermaid_theme_invalid')
      .map(e => e.message);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const unsafeFindings = await findingsFor('theme:\n  mermaid:\n    light:\n      fontFamily: "x;} svg { fill: red"\n');
assert(
  unsafeFindings.length === 1 &&
    unsafeFindings[0]?.includes('theme.mermaid.light.fontFamily') === true &&
    unsafeFindings[0]?.includes('# % ( ) , . ; -') === true,
  `FAIL: an unsafe value is reported by key with the allowed characters, got ${JSON.stringify(unsafeFindings)}`,
);

const valueFindings = await findingsFor('theme:\n  mermaid:\n    dark:\n      primaryColor: "#000000"\n      lineColor: [1, 2]\n');
assert(
  valueFindings.length === 1 && valueFindings[0]?.includes('theme.mermaid.dark.lineColor') === true,
  `FAIL: a list value is reported by key, got ${JSON.stringify(valueFindings)}`,
);

const blockFindings = await findingsFor('theme:\n  mermaid: blue\n');
assert(
  blockFindings.length === 1 && blockFindings[0]?.includes('theme.mermaid') === true,
  `FAIL: a non-object block is reported, got ${JSON.stringify(blockFindings)}`,
);

const modeFindings = await findingsFor('theme:\n  mermaid:\n    light: 3\n');
assert(
  modeFindings.length === 1 && modeFindings[0]?.includes('theme.mermaid.light') === true,
  `FAIL: a non-object mode block is reported, got ${JSON.stringify(modeFindings)}`,
);

assert((await findingsFor('theme:\n  mermaid:\n    dark:\n      fontSize: 15\n')).length === 0, 'FAIL: valid values raise no finding');

// `ignatius validate` reports the warning and still passes the model.
const ROOT = resolve(import.meta.dir, '../..');
const cliRoot = mkdtempSync(join(tmpdir(), 'ignatius-mermaid-theme-cli-'));
try {
  const fixture = join(ROOT, 'models/key-inherited');
  const leftovers = new Set([join(fixture, '.ignatius'), join(fixture, '.gitignore')]);
  cpSync(fixture, cliRoot, { recursive: true, filter: source => !leftovers.has(source) });
  appendFileSync(join(cliRoot, 'ignatius.yml'), '  mermaid:\n    dark:\n      lineColor: [1, 2]\n');
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli/cli.ts'), 'validate', cliRoot], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), 30_000);
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  assert(exitCode === 0, `FAIL: validate exits 0 when the only finding is a bad mermaid theme value, got ${exitCode}\n${stderr}`);
  assert(
    /warn\s+config\.mermaid_theme_invalid\s+.*theme\.mermaid\.dark\.lineColor/.test(stderr),
    `FAIL: validate prints the warning naming the key, got:\n${stderr}`,
  );
} finally {
  rmSync(cliRoot, { recursive: true, force: true });
}

console.log(process.exitCode ? 'mermaid-theme: failures above.' : 'All mermaid-theme checks passed.');
