/**
 * test-update-progress.ts — unit tests for `downloadProgressRenderer`, the
 * pure `\r`-rewriting status line behind `ignatius update`'s download step.
 *
 * No network, no TTY: `write` is captured into an array and `isTTY` is passed
 * explicitly, so every branch (off-TTY, mid-stream, 100% latch, unknown total)
 * is deterministic.
 */

import { downloadProgressRenderer } from '../../src/cli/update';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── off-TTY ──────────────────────────────────────────────────────────────────

{
  const lines: string[] = [];
  const renderer = downloadProgressRenderer((s) => lines.push(s), false);
  assert(renderer === null, 'off-TTY returns null');
  console.log('PASS: off-TTY returns null');
}

// ── mid-stream, known total ──────────────────────────────────────────────────

{
  const lines: string[] = [];
  const renderer = downloadProgressRenderer((s) => lines.push(s), true);
  assert(renderer !== null, 'TTY returns a renderer');
  renderer!(5 * 1024 * 1024, 10 * 1024 * 1024);
  assert(lines.length === 1, 'mid-stream writes exactly once');
  assert(lines[0]!.startsWith('\rDownloading 5.0 / 10.0 MB (50%)'), `mid-stream line: ${lines[0]}`);
  assert(!lines[0]!.endsWith('\n'), 'mid-stream line has no trailing newline');
  console.log('PASS: mid-stream known total');
}

// ── final tick latches quiet ─────────────────────────────────────────────────

{
  const lines: string[] = [];
  const renderer = downloadProgressRenderer((s) => lines.push(s), true)!;
  const total = 10 * 1024 * 1024;
  renderer(total, total);
  assert(lines.length === 1, 'final tick writes exactly once');
  assert(lines[0]!.includes('100%'), `final line has 100%: ${lines[0]}`);
  assert(lines[0]!.endsWith('\n'), 'final line ends with newline');

  renderer(total, total);
  renderer(total + 1024, total);
  assert(lines.length === 1, 'calls after 100% write nothing');
  console.log('PASS: final tick latches quiet');
}

// ── unknown total ─────────────────────────────────────────────────────────────

{
  const lines: string[] = [];
  const renderer = downloadProgressRenderer((s) => lines.push(s), true)!;
  renderer(3 * 1024 * 1024, 0);
  assert(lines.length === 1, 'unknown total writes exactly once');
  assert(lines[0]!.startsWith('\rDownloading 3.0 MB'), `unknown-total line: ${lines[0]}`);
  assert(!lines[0]!.includes('%'), 'unknown-total line has no percent');
  assert(!lines[0]!.endsWith('\n'), 'unknown-total line has no trailing newline');
  console.log('PASS: unknown total');
}

console.log('\nAll update-progress assertions passed.');
