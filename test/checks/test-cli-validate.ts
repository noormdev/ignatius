/**
 * Tests for the `validate` subcommand — a validate-only quality gate.
 *
 * Verifies:
 * - Validates without generating any HTML output (no -o, no "Wrote ..." line).
 * - Clean model (key-inherited) → exit 0, "valid" summary, no error lines.
 * - Broken model (broken-demo) → exit 1, same 4 errors + 7 warnings as dict/graph.
 * - Findings print to stderr in the shared "<severity>  <ruleId>  <location>  <message>" format.
 *
 * WHY run via `bun src/cli.ts` not the binary: faster CI iteration, no prior build:cli.
 */

import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '../..');
const CLEAN = join(ROOT, 'models/key-inherited');
const BROKEN = join(ROOT, 'models/broken-demo');

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), 30_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  return { exitCode, stdout, stderr };
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
// Test 1: clean model → exit 0, valid summary, no errors, no output artifact
// ---------------------------------------------------------------------------
{
  const { exitCode, stdout, stderr } = await run(['validate', CLEAN]);
  assert(exitCode === 0, 'validate clean model: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
  assert(/valid/i.test(stdout), 'validate clean model: stdout reports valid', `stdout: ${stdout}`);
  assert(!/Wrote/i.test(stdout), 'validate writes no output artifact (no "Wrote ..." line)', `stdout: ${stdout}`);
  const errorLines = stderr.split('\n').filter(l => l.startsWith('error'));
  assert(errorLines.length === 0, 'validate clean model: no error lines on stderr',
    `errors:\n${errorLines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Test 2: broken model → exit 1, 4 errors + 7 warnings, shared stderr format
// ---------------------------------------------------------------------------
{
  const { exitCode, stdout, stderr } = await run(['validate', BROKEN]);
  assert(exitCode === 1, 'validate broken model: exit 1 (globals present)', `got ${exitCode}`);

  const lines = stderr.split('\n').filter(l => l.trim() !== '');
  const errorLines = lines.filter(l => l.startsWith('error'));
  const warnLines = lines.filter(l => l.startsWith('warn'));
  assert(errorLines.length === 4, `validate broken model: 4 error lines (got ${errorLines.length})`,
    `stderr:\n${stderr.slice(0, 800)}`);
  assert(warnLines.length === 7, `validate broken model: 7 warn lines (got ${warnLines.length})`);

  const formatRe = /^(error|warn)\s{2,}\S+\s{2,}\S+\s{2,}[\s\S]+$/;
  const malformed = lines.filter(l => (l.startsWith('error') || l.startsWith('warn')) && !formatRe.test(l));
  assert(malformed.length === 0, 'validate stderr: lines match <severity> <ruleId> <location> <message>',
    malformed.length ? `malformed:\n${malformed.slice(0, 3).join('\n')}` : undefined);

  assert(!/Wrote/i.test(stdout), 'validate broken model: writes no output artifact', `stdout: ${stdout}`);
}

console.log('\n' + (failures === 0 ? 'All cli-validate tests passed.' : `${failures} cli-validate test(s) FAILED.`));
if (failures > 0) process.exit(1);
