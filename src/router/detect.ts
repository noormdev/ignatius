/**
 * detect.ts — resolves `harness:` config plus an ancestor filesystem probe
 * into whether `--agents` should write the `CLAUDE.md` shim. `AGENTS.md` and
 * `SKILL.md` are unconditional; only the shim depends on this.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HarnessMode } from '../model/parse';

/** Walks from `root` up to the filesystem root, stopping at the first `.claude/` directory or `CLAUDE.md` file. */
function ancestorHasClaudeMarker(root: string): boolean {
  let dir = resolve(root);
  while (true) {
    if (existsSync(`${dir}/.claude`) || existsSync(`${dir}/CLAUDE.md`)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Whether `--agents` should write the `CLAUDE.md` shim, per `harness:` (default `auto`). */
export function resolveHarness(root: string, mode: HarnessMode | undefined): boolean {
  switch (mode ?? 'auto') {
    case 'claude':
    case 'both':
      return true;
    case 'agents':
      return false;
    case 'auto':
      return ancestorHasClaudeMarker(root);
  }
}
