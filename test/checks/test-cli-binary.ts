/**
 * Integration tests for the compiled ignatius binary.
 *
 * WHY: The binary is the primary artifact of CP-7. These tests verify all three
 * subcommands work after compile — no dev-mode fallbacks, no filesystem assumptions.
 *
 * Must be run AFTER `bun run build:cli` has produced ./dist/ignatius.
 *
 * Run with: bun test/test-cli-binary.ts
 */

import { existsSync } from 'fs';
import { join } from 'path';

// Resolve paths relative to the project root (worktree root is one dir up from tmp/)
const ROOT = join(import.meta.dir, '../..');
const BINARY = join(ROOT, 'dist', 'ignatius');
const MODELS = join(ROOT, 'models');
const OUT_DICT = join(ROOT, 'tmp', 'out-binary-dict.html');
const OUT_GRAPH = join(ROOT, 'tmp', 'out-binary-graph.html');

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

assert(existsSync(BINARY), `binary exists at dist/ignatius`);

// ──────────────────────────────────────────────────────────────────────────────
// --help
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode, stdout } = await run(['--help']);
  assert(exitCode === 0, '--help: exits 0');
  assert(stdout.includes('serve'), '--help: stdout contains "serve"');
  assert(stdout.includes('dict'), '--help: stdout contains "dict"');
  assert(stdout.includes('graph'), '--help: stdout contains "graph"');
}

// ──────────────────────────────────────────────────────────────────────────────
// dict subcommand
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode } = await run(['dict', MODELS]);
  assert(exitCode === 1, 'dict without -o: exits 1');
}

{
  const { exitCode, stderr } = await run(['dict', MODELS, '-o', OUT_DICT]);
  if (exitCode !== 0) console.error('dict stderr:', stderr);
  assert(exitCode === 0, 'dict with -o: exits 0');
  assert(existsSync(OUT_DICT), 'dict: output file exists');

  if (existsSync(OUT_DICT)) {
    const content = await Bun.file(OUT_DICT).text();
    assert(content.toLowerCase().includes('<!doctype html>'), 'dict: output contains <!doctype html>');
    assert(content.includes('id="entity-Party"'), 'dict: output contains entity-Party anchor');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// graph subcommand
// ──────────────────────────────────────────────────────────────────────────────

{
  const { exitCode } = await run(['graph', MODELS]);
  assert(exitCode === 1, 'graph without -o: exits 1');
}

{
  const { exitCode, stderr } = await run(['graph', MODELS, '-o', OUT_GRAPH]);
  if (exitCode !== 0) console.error('graph stderr:', stderr);
  assert(exitCode === 0, 'graph with -o: exits 0');
  assert(existsSync(OUT_GRAPH), 'graph: output file exists');

  if (existsSync(OUT_GRAPH)) {
    const content = await Bun.file(OUT_GRAPH).text();
    assert(content.toLowerCase().includes('<!doctype html>'), 'graph: output contains <!doctype html>');
    assert(content.includes('window.__MODEL__'), 'graph: output contains window.__MODEL__');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// serve subcommand (background process)
// ──────────────────────────────────────────────────────────────────────────────

{
  const PORT = 3499;
  const proc = Bun.spawn([BINARY, 'serve', MODELS, '--port', String(PORT)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Give the server a moment to bind
  await Bun.sleep(1500);

  let model: { nodes?: unknown[] } = {};
  try {
    const res = await fetch(`http://localhost:${PORT}/api/model`);
    model = await res.json() as typeof model;
  } finally {
    proc.kill();
    await proc.exited;
  }

  assert(Array.isArray(model.nodes), 'serve: /api/model returns array of nodes');
  assert((model.nodes as unknown[]).length === 24, `serve: /api/model returns 24 nodes (got ${(model.nodes as unknown[]).length})`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────────────────────────────────────────

for (const f of [OUT_DICT, OUT_GRAPH]) {
  if (existsSync(f)) {
    try { await Bun.file(f).delete?.(); } catch { /* ignore */ }
  }
}

console.log(`\nResults: ${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
