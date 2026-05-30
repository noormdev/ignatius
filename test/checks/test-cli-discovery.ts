/**
 * Integration tests for model discovery via the compiled ignatius binary.
 *
 * WHY: CP-3 wires resolveModel + a clack picker into all three subcommands.
 * These tests verify the non-interactive paths (--model select, non-TTY
 * ambiguous error + key list, single-root, --help).
 *
 * Spawned processes are non-TTY → clack `select` is never triggered.
 *
 * Must be run AFTER `bun run build:cli` has produced ./dist/ignatius.
 *
 * Run with: bun test/checks/test-cli-discovery.ts
 */

import { existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const BINARY = join(ROOT, 'dist', 'ignatius');
const MODELS = join(ROOT, 'models');                   // container with 3 model roots
const SINGLE = join(ROOT, 'models', 'key-inherited'); // single model root
const OUT = join(ROOT, 'tmp', 'test-discovery-out.html');

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

async function run(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([BINARY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => proc.kill(), timeoutMs);

  const [exitCode, stdoutBuf, stderrBuf] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);

  return { exitCode, stdout: stdoutBuf, stderr: stderrBuf };
}

// ──────────────────────────────────────────────────────────────────────────────
// Sanity: binary exists
// ──────────────────────────────────────────────────────────────────────────────

assert(existsSync(BINARY), 'binary exists at dist/ignatius');

// ──────────────────────────────────────────────────────────────────────────────
// --help: exits 0 and documents --model
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode, stdout } = await run(['dict', '--help']);
  assert(exitCode === 0, 'dict --help: exits 0');
  assert(stdout.includes('--model'), 'dict --help: documents --model');
}

// ──────────────────────────────────────────────────────────────────────────────
// dict container + --model orm-pure → no prompt, exit 0, file written
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode, stderr } = await run(['dict', MODELS, '--model', 'orm-pure', '-o', OUT]);
  if (exitCode !== 0) console.error('  stderr:', stderr);
  assert(exitCode === 0, 'dict <container> --model orm-pure: exits 0');
  assert(existsSync(OUT), 'dict <container> --model orm-pure: output file written');
  // clean up
  if (existsSync(OUT)) {
    try { await Bun.file(OUT).delete?.(); } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// dict container without --model, non-TTY → exit ≠ 0, stderr lists keys
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode, stderr } = await run(['dict', MODELS, '-o', OUT], { timeoutMs: 5_000 });
  assert(exitCode !== 0, 'dict <container> no --model non-TTY: exits non-zero');
  assert(
    stderr.includes('key-inherited') && stderr.includes('orm-hybrid') && stderr.includes('orm-pure'),
    'dict <container> no --model non-TTY: stderr lists all three keys',
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// dict single-root path → exit 0, file written
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode, stderr } = await run(['dict', SINGLE, '-o', OUT]);
  if (exitCode !== 0) console.error('  stderr:', stderr);
  assert(exitCode === 0, 'dict <single-root>: exits 0');
  assert(existsSync(OUT), 'dict <single-root>: output file written');
  // clean up
  if (existsSync(OUT)) {
    try { await Bun.file(OUT).delete?.(); } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Results
// ──────────────────────────────────────────────────────────────────────────────

console.log(`\nResults: ${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
