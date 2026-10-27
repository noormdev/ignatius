/** test-mermaid-theme.ts — diagrams default to bold outlines on the entity colours, `theme.mermaid` overrides them,
 *  and nothing unsafe from ignatius.yml reaches the diagram stylesheet: it is dropped with a warning. */

import { appendFileSync, cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultTheme, mergeTheme, SAFE_MERMAID_VALUE, type ThemeConfig, type ThemeMode } from '../../src/theme/theme-defaults';
import { DEFAULT_MERMAID_FILLS, resolveMermaidStyle, resolveMermaidThemeVariables } from '../../src/theme/mermaid-theme';
import { parseModels } from '../../src/model/parse';
import { RULES, validateModel } from '../../src/model/validate';
import { assert } from '../assert';

const cssFor = (theme: ThemeConfig, mode: ThemeMode) => resolveMermaidStyle(theme, mode).themeCSS;

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
  const vars = resolveMermaidThemeVariables(defaultTheme, mode);
  const [blue, amber, green] = DEFAULT_MERMAID_FILLS;

  // Node fills are the entity colours at full strength in both modes; the connectors carry the mode.
  const table: Record<string, string | undefined> = {
    fontSize: '14px',
    background: p.background,
    primaryColor: blue,
    primaryBorderColor: '#000000',
    primaryTextColor: '#000000',
    secondaryColor: amber,
    tertiaryColor: green,
    lineColor: mode === 'light' ? p.text : p.textMuted,
    textColor: p.text,
    noteBkgColor: green,
    noteTextColor: '#000000',
    clusterBkg: p.background,
    clusterBorder: '#000000',
    edgeLabelBackground: p.background,
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

  for (let i = 0; i < 12; i++) {
    const fill = DEFAULT_MERMAID_FILLS[i % DEFAULT_MERMAID_FILLS.length] ?? '';
    assert(vars[`cScale${i}`] === fill, `FAIL(${mode}): cScale${i} cycles the node fills (${fill}), got ${String(vars[`cScale${i}`])}`);
    assert(vars[`pie${i + 1}`] === fill, `FAIL(${mode}): pie${i + 1} cycles the node fills`);
    const label = vars[`cScaleLabel${i}`];
    const best = contrast('#000000', fill) >= contrast('#ffffff', fill) ? '#000000' : '#ffffff';
    assert(label === best, `FAIL(${mode}): cScaleLabel${i} on ${fill} is the higher-contrast of black and white (${best}), got ${String(label)}`);
  }

  // Bold look: every default fill carries black labels at WCAG AA or better.
  for (const fill of DEFAULT_MERMAID_FILLS) {
    assert(contrast('#000000', fill) >= 4.5, `FAIL: black labels read on the default fill ${fill}`);
  }

  const css = cssFor(defaultTheme, mode);
  assert(/rect\.actor[^{]*\{\s*stroke: #000000;\s*stroke-width: 3px;/.test(css), `FAIL(${mode}): node outlines default to 3px black`);
  assert(/\.relationshipLine \{ stroke-width: 2\.6px; \}/.test(css), `FAIL(${mode}): connectors default to 85% of the outline`);
  assert(/rx: 8px;/.test(css), `FAIL(${mode}): node corners default to an 8px radius`);
  assert(/filter: drop-shadow\(/.test(css), `FAIL(${mode}): nodes cast a shadow by default`);
  assert(/\.nodeLabel \{ font-weight: 600; \}/.test(css), `FAIL(${mode}): node labels are bold`);
  assert(new RegExp(`\\.node\\.ignatius-decision [^{]+\\{ fill: ${amber}; \\}`).test(css), `FAIL(${mode}): decisions take the second fill`);
  assert(new RegExp(`\\.node\\.ignatius-store [^{]+\\{ fill: ${blue}; \\}`).test(css), `FAIL(${mode}): stores take the first fill`);
  // Labels that sit on the page, not on a fill, keep the page ink.
  assert(vars['stateLabelColor'] === p.text, `FAIL(${mode}): composite-state titles use the page ink`);
  assert(css.includes(`.cluster-label .nodeLabel { color: ${p.text}; }`), `FAIL(${mode}): cluster titles use the page ink`);
  // Mermaid paints gantt text beside a bar and on done bars with taskTextDarkColor; both sit on the page tone.
  const doneText = String(vars['taskTextDarkColor']);
  assert(contrast(doneText, String(vars['doneTaskBkgColor'])) >= 4.5, `FAIL(${mode}): done gantt text reads on the done bar`);
  assert(contrast(doneText, p.background) >= 4.5, `FAIL(${mode}): gantt text beside a bar reads on the page`);
  const activeInk = contrast('#000000', String(vars['activeTaskBkgColor'])) >= contrast('#ffffff', String(vars['activeTaskBkgColor'])) ? '#000000' : '#ffffff';
  assert(css.includes(`{ fill: ${activeInk} !important; }`), `FAIL(${mode}): active gantt text is recoloured for the active bar`);
}

// The four style keys reach the theme CSS, each with a value no other rule emits.
const styled = mergeTheme({ mermaid: { stroke_width: 5, radius: 0, shadow: false, node_fills: ['#2a1f4a', '#ffffff'] } });
const styledCss = cssFor(styled, 'light');
assert(/rect\.actor[^{]*\{\s*stroke: #000000;\s*stroke-width: 5px;/.test(styledCss), 'FAIL: stroke_width sets the outline width');
assert(/\.relationshipLine \{ stroke-width: 4\.3px; \}/.test(styledCss), 'FAIL: stroke_width scales the connectors');
assert(/rx: 0px;/.test(styledCss), 'FAIL: radius sets the corner radius');
assert(/filter: none;/.test(styledCss) && !styledCss.includes('drop-shadow'), 'FAIL: shadow: false removes the shadow');
const cycleRule = (n: number, fill: string, ink: string) =>
  new RegExp(`\\.node:nth-child\\(2n\\+${n}\\) [^{]+\\{ fill: ${fill}; \\}\\n\\.node:nth-child\\(2n\\+${n}\\) \\.nodeLabel \\{ color: ${ink}; \\}`);
assert(cycleRule(1, '#2a1f4a', '#ffffff').test(styledCss), 'FAIL: a dark node fill gets white labels');
assert(cycleRule(2, '#ffffff', '#000000').test(styledCss), 'FAIL: a light node fill gets black labels');
assert(
  /\.node \.label:is\(\.attribute-name[^)]*\) \.nodeLabel \{ color: #000000; \}/.test(styledCss),
  'FAIL: ER attribute labels stay black on their white rows whatever the node fills',
);
const styledVars = resolveMermaidThemeVariables(styled, 'dark');
assert(styledVars['primaryColor'] === '#2a1f4a', 'FAIL: node_fills feeds the themeVariables too');
// White reads on #2a1f4a at 15:1 and on #ffffff at 1:1; black reads at 1.4:1 and 21:1. Black's worst case is better.
assert(styledVars['pieSectionTextColor'] === '#000000', 'FAIL: one label slot over mixed fills takes the colour with the best worst case');

const badStyle = mergeTheme({ mermaid: { stroke_width: 40, radius: '8px', shadow: 'yes', node_fills: ['red', '#ff0000;}'], strokeWidth: 2 } });
assert(
  JSON.stringify(badStyle.invalidMermaidKeys) === JSON.stringify(['theme.mermaid.strokeWidth', 'theme.mermaid.stroke_width', 'theme.mermaid.radius', 'theme.mermaid.shadow', 'theme.mermaid.node_fills']),
  `FAIL: each invalid or unknown style key is reported, got ${JSON.stringify(badStyle.invalidMermaidKeys)}`,
);
assert(cssFor(badStyle, 'dark') === cssFor(defaultTheme, 'dark'), 'FAIL: invalid style keys fall back to the defaults');

// A palette colour carrying CSS reaches neither half of the Mermaid theme, and is reported.
const beacon = '#23262b; } * { background-image: url(/beacon) } .x {';
const injected = mergeTheme({ light: { text: beacon }, dark: { background: beacon } });
for (const mode of ['dark', 'light'] satisfies ThemeMode[]) {
  const style = resolveMermaidStyle(injected, mode);
  assert(!style.themeCSS.includes('beacon'), `FAIL(${mode}): an unsafe palette colour never reaches themeCSS`);
  assert(!JSON.stringify(style.themeVariables).includes('beacon'), `FAIL(${mode}): an unsafe palette colour never reaches themeVariables`);
}
assert(resolveMermaidThemeVariables(injected, 'light')['textColor'] === defaultTheme.light.text, 'FAIL: an unsafe palette colour falls back to the default');
assert(
  JSON.stringify(injected.invalidMermaidKeys) === JSON.stringify(['theme.dark.background', 'theme.light.text']),
  `FAIL: each unsafe palette colour is reported, got ${JSON.stringify(injected.invalidMermaidKeys)}`,
);

// A mode-block lineColor reaches every connector, including the ones themeCSS paints.
const purple = mergeTheme({ mermaid: { light: { lineColor: '#6d4fd8', transitionLabelColor: '#6d4fd8' } } });
assert(/\.loopLine \{ stroke: #6d4fd8;/.test(cssFor(purple, 'light')), 'FAIL: a lineColor override recolours sequence loop lines');
assert(/\.labelBkg \{[^}]*color: #6d4fd8;/.test(cssFor(purple, 'light')), 'FAIL: a label colour override recolours edge labels');

const overridden = mergeTheme({ mermaid: { dark: { primaryColor: '#123456', fontSize: 16 } } });
const darkVars = resolveMermaidThemeVariables(overridden, 'dark');
const lightVars = resolveMermaidThemeVariables(overridden, 'light');
assert(darkVars['primaryColor'] === '#123456', 'FAIL: theme.mermaid.dark overrides primaryColor');
assert(darkVars['fontSize'] === 16, 'FAIL: a number override is kept');
assert(darkVars['lineColor'] === defaultTheme.dark.textMuted, 'FAIL: an override leaves the other defaults alone');
assert(lightVars['primaryColor'] === DEFAULT_MERMAID_FILLS[0], 'FAIL: a dark override does not touch light');

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

// Each style key's finding states that key's own rule, so the author learns what is allowed.
const styleFindings = await findingsFor('theme:\n  mermaid:\n    stroke_width: 40\n    node_fills:\n      - #58a6ff\n    strokeWidth: 2\n');
assert(styleFindings.some(m => m.includes('theme.mermaid.stroke_width') && m.includes('from 0 to 8')), `FAIL: an out-of-range stroke_width names its range, got ${JSON.stringify(styleFindings)}`);
assert(styleFindings.some(m => m.includes('theme.mermaid.node_fills') && m.includes('quoted "#rrggbb"')), `FAIL: an unquoted fill list asks for quoted colours, got ${JSON.stringify(styleFindings)}`);
assert(styleFindings.some(m => m.includes('theme.mermaid.strokeWidth') && m.includes('not a Mermaid theme key')), `FAIL: an unknown key is named as unknown, got ${JSON.stringify(styleFindings)}`);

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
