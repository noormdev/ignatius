/**
 * Integration tests for the compiled derek binary.
 *
 * WHY: The binary is the primary artifact of CP-7. These tests verify all three
 * subcommands work after compile — no dev-mode fallbacks, no filesystem assumptions.
 *
 * Must be run AFTER `bun run build:cli` has produced ./dist/derek.
 */

import { test, expect, afterAll } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';

// Resolve paths relative to the project root (worktree root is two dirs up from tmp/)
const ROOT = join(import.meta.dir, '..');
const BINARY = join(ROOT, 'dist', 'derek');
const MODELS = join(ROOT, 'models');
const OUT_DICT = join(ROOT, 'tmp', 'out-binary-dict.html');
const OUT_GRAPH = join(ROOT, 'tmp', 'out-binary-graph.html');

// ──────────────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────────────

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

test('binary exists at dist/derek', () => {
  expect(existsSync(BINARY)).toBe(true);
});

// ──────────────────────────────────────────────────────────────────────────────
// --help
// ──────────────────────────────────────────────────────────────────────────────

test('--help includes serve, dict, graph', async () => {
  const { exitCode, stdout } = await run(['--help']);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('serve');
  expect(stdout).toContain('dict');
  expect(stdout).toContain('graph');
});

// ──────────────────────────────────────────────────────────────────────────────
// dict subcommand
// ──────────────────────────────────────────────────────────────────────────────

test('dict: requires -o flag, exits 1 without it', async () => {
  const { exitCode } = await run(['dict', MODELS]);
  expect(exitCode).toBe(1);
});

test('dict: produces HTML file with expected content', async () => {
  const { exitCode, stderr } = await run(['dict', MODELS, '-o', OUT_DICT]);
  if (exitCode !== 0) {
    console.error('dict stderr:', stderr);
  }
  expect(exitCode).toBe(0);
  expect(existsSync(OUT_DICT)).toBe(true);

  const content = await Bun.file(OUT_DICT).text();
  // Doctype
  expect(content.toLowerCase()).toContain('<!doctype html>');
  // Party entity is expected in the sample models
  expect(content).toContain('id="entity-Party"');
});

// ──────────────────────────────────────────────────────────────────────────────
// graph subcommand
// ──────────────────────────────────────────────────────────────────────────────

test('graph: requires -o flag, exits 1 without it', async () => {
  const { exitCode } = await run(['graph', MODELS]);
  expect(exitCode).toBe(1);
});

test('graph: produces HTML file with expected content', async () => {
  const { exitCode, stderr } = await run(['graph', MODELS, '-o', OUT_GRAPH]);
  if (exitCode !== 0) {
    console.error('graph stderr:', stderr);
  }
  expect(exitCode).toBe(0);
  expect(existsSync(OUT_GRAPH)).toBe(true);

  const content = await Bun.file(OUT_GRAPH).text();
  // Self-contained HTML
  expect(content.toLowerCase()).toContain('<!doctype html>');
  // Model is embedded
  expect(content).toContain('window.__MODEL__');
});

// ──────────────────────────────────────────────────────────────────────────────
// serve subcommand (background process)
// ──────────────────────────────────────────────────────────────────────────────

test('serve: /api/model returns 24 nodes', async () => {
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

  expect(Array.isArray(model.nodes)).toBe(true);
  expect((model.nodes as unknown[]).length).toBe(24);
}, 20_000);

// ──────────────────────────────────────────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Remove generated output files — leave screenshots/other test artifacts alone
  for (const f of [OUT_DICT, OUT_GRAPH]) {
    if (existsSync(f)) {
      await Bun.file(f).delete?.();
    }
  }
});
