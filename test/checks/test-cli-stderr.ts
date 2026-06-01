/**
 * Tests for CLI stderr findings output (CP-4).
 *
 * Verifies:
 * - Format: "<severity>  <ruleId>  <location>  <message>" per line
 * - Sort: errors first, then by ruleId, then by entityId
 * - Exit code 0 when only warnings (real models/ has no GlobalErrors)
 * - Exit code 1 when GlobalErrors exist (fixture with malformed file)
 *
 * WHY run via `bun src/cli.ts` not the binary: binary requires a prior
 * build:cli; this test targets the source path for faster CI iteration.
 */

import { join, resolve } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/broken-demo');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const OUT = join(TMP, 'dict-cli-stderr.html');

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timer = setTimeout(() => proc.kill(), 30_000);
  const [exitCode, stdoutBuf, stderrBuf] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);

  return { exitCode, stdout: stdoutBuf, stderr: stderrBuf };
}

let failures = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: dict subcommand on real models/ — format, count, exit code
// ---------------------------------------------------------------------------

{
  const { exitCode, stderr } = await run(['dict', MODELS, '-o', OUT]);

  // Exit code 0: real models/ has no GlobalErrors (only EntityError warnings)
  // broken-demo has 4 GlobalErrors → exit code 1
  assert(exitCode === 1, 'dict against broken-demo: exit code 1 (globals present)', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);

  const lines = stderr.split('\n').filter(l => l.trim() !== '');

  // Every non-empty line must match the format: severity  ruleId  location  message
  const formatRe = /^(error|warn)\s{2,}\S+\s{2,}\S+\s{2,}[\s\S]+$/;
  const malformed = lines.filter(l => !formatRe.test(l) && !l.startsWith('  ') && !l.startsWith('\t'));
  assert(malformed.length === 0, 'dict stderr: all lines match <severity>  <ruleId>  <location>  <message> format',
    malformed.length > 0 ? `malformed lines:\n${malformed.slice(0, 5).join('\n')}` : undefined);

  // broken-demo baseline: 4 errors, 8 warnings (incl. body.unknown_link).
  const warnLines = lines.filter(l => l.startsWith('warn'));
  assert(warnLines.length === 8, `dict stderr: 8 warn lines (got ${warnLines.length})`,
    `stderr:\n${stderr.slice(0, 1000)}`);

  const errorLines = lines.filter(l => l.startsWith('error'));
  assert(errorLines.length === 4, `dict stderr: 4 error lines (got ${errorLines.length})`);

  // Errors should appear before warnings; within each, ruleIds sorted alphabetical.
  const severityFirst = lines.filter(l => l.startsWith('error') || l.startsWith('warn'));
  let sawWarn = false;
  let outOfOrder = false;
  for (const l of severityFirst) {
    if (l.startsWith('warn')) sawWarn = true;
    else if (sawWarn && l.startsWith('error')) { outOfOrder = true; break; }
  }
  assert(!outOfOrder, 'dict stderr: errors before warnings');

  const warnRuleIds = warnLines.map(l => l.split(/\s{2,}/)[1] ?? '');
  const sortedWarnRuleIds = [...warnRuleIds].sort();
  assert(JSON.stringify(warnRuleIds) === JSON.stringify(sortedWarnRuleIds),
    'dict stderr: warn lines sorted by ruleId', `got:\n${warnRuleIds.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Test 2: graph subcommand on real models/ — same stderr behavior
// ---------------------------------------------------------------------------

{
  const OUT_GRAPH = join(TMP, 'graph-cli-stderr.html');
  // graph needs the bundle — skip if not built
  const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
  if (!bundleExists) {
    console.log('  SKIP  graph stderr test: dist/static/index.js not built');
  } else {
    const { exitCode, stderr } = await run(['graph', MODELS, '-o', OUT_GRAPH]);
    assert(exitCode === 1, 'graph against broken-demo: exit code 1', `stderr:\n${stderr.slice(0, 300)}`);

    const lines = stderr.split('\n').filter(l => l.trim() !== '');
    const warnLines = lines.filter(l => l.startsWith('warn'));
    assert(warnLines.length === 8, `graph stderr: 8 warn lines (got ${warnLines.length})`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: malformed fixture → exit code 1 + error lines
// ---------------------------------------------------------------------------

{
  const fixtureDir = join(TMP, 'test-fixtures/cli-stderr-globals');
  rmSync(fixtureDir, { recursive: true, force: true });
  // parseModels scans _groups/ dir — must exist or it throws before reaching the entity files.
  mkdirSync(join(fixtureDir, '_groups'), { recursive: true });
  // ignatius.yml marks this as a discoverable model root post-master-reconcile.
  writeFileSync(join(fixtureDir, 'ignatius.yml'), 'name: cli-stderr-globals-fixture\n');

  // Valid entity so parseModels doesn't return an empty model
  writeFileSync(join(fixtureDir, 'ValidEntity.md'), [
    '---',
    'entity: ValidEntity',
    'pk: [id]',
    'columns:',
    '  id: integer',
    '---',
    '',
    'A valid entity.',
  ].join('\n'));

  // Malformed YAML — will produce parse.invalid_yaml GlobalError
  writeFileSync(join(fixtureDir, 'BadEntity.md'), [
    '---',
    'entity: BadEntity',
    'pk: [id',   // unclosed bracket — invalid YAML
    '---',
    '',
    'A broken entity.',
  ].join('\n'));

  const OUT_FIXTURE = join(TMP, 'dict-fixture-globals.html');
  const { exitCode, stderr } = await run(['dict', fixtureDir, '-o', OUT_FIXTURE]);

  assert(exitCode === 1, 'dict with GlobalError: exit code 1', `stderr:\n${stderr}`);

  const errorLines = stderr.split('\n').filter(l => l.startsWith('error'));
  assert(errorLines.length > 0, 'dict with GlobalError: error lines present in stderr',
    `stderr:\n${stderr}`);

  // Error line must include a parse.* ruleId
  const hasParseRule = errorLines.some(l => l.includes('parse.'));
  assert(hasParseRule, 'dict with GlobalError: error line includes a parse.* ruleId',
    `error lines:\n${errorLines.join('\n')}`);

  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log('\n' + (failures === 0 ? 'All cli-stderr tests passed.' : `${failures} cli-stderr test(s) FAILED.`));
if (failures > 0) process.exit(1);
