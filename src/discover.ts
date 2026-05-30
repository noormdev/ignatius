// Pure model-root discovery resolver.
// No TTY, no citty, no clack, no process.stdin — caller handles many/none.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';

export interface ModelCandidate {
  /** Absolute path to the directory containing ignatius.yml */
  dir: string;
  /** Path relative to the search base — '' when base itself is the root */
  key: string;
  /** Value of `name:` in ignatius.yml, or undefined if missing/invalid */
  name: string | undefined;
}

export type ResolveResult =
  | { kind: 'single'; model: ModelCandidate }
  | { kind: 'many'; models: ModelCandidate[] }
  | { kind: 'no-match'; available: ModelCandidate[] }
  | { kind: 'none' };

export interface ResolveOptions {
  /** Value of --model flag; used to filter candidates when >1 found */
  model?: string;
  /**
   * Optional ceiling directory for the walk-up phase (step 3).
   * Walk-up stops at this directory (inclusive) rather than continuing to fs root.
   * Useful in tests to prevent walk-up from escaping the fixture tree.
   */
  ceiling?: string;
}

const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'tmp',
  'trash',
  '.worktrees',
  '.claude',
]);

function shouldSkip(name: string): boolean {
  return name.startsWith('_') || SKIP_NAMES.has(name);
}

function readName(dir: string): string | undefined {
  const ymlPath = join(dir, 'ignatius.yml');
  try {
    const raw = readFileSync(ymlPath, 'utf8');
    const parsed = parseYaml(raw);
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      // parsed is any (yaml library), 'name' in parsed confirms the key exists
      const n: unknown = parsed.name;
      return typeof n === 'string' ? n : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function makeCandidate(dir: string, base: string): ModelCandidate {
  const rel = relative(base, dir);
  // On Windows sep would differ; normalize to forward slashes for key
  const key = rel.split(sep).join('/');
  return { dir, key, name: readName(dir) };
}

/** Recursively collect all ignatius.yml roots under `dir`, skipping SKIP_NAMES and _-prefixed dirs. */
function searchDown(dir: string, base: string, results: ModelCandidate[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (shouldSkip(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    if (existsSync(join(full, 'ignatius.yml'))) {
      results.push(makeCandidate(full, base));
      // Do not recurse further into a model root — it is a leaf
    } else {
      searchDown(full, base, results);
    }
  }
}

/**
 * Walk up from `dir` looking for the first ignatius.yml.
 * Stops at `ceiling` (inclusive) if provided; defaults to fs root.
 */
function walkUp(dir: string, ceiling?: string): string | null {
  let current = resolve(dir);
  const stop = ceiling !== undefined ? resolve(ceiling) : null;
  while (true) {
    if (existsSync(join(current, 'ignatius.yml'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) return null; // reached fs root
    if (stop !== null && current === stop) return null; // reached ceiling without finding one
    current = parent;
  }
}

/**
 * Resolve which model root(s) to use given a starting path and optional --model key.
 *
 * Algorithm:
 *   1. If base/ignatius.yml exists → single (base itself).
 *   2. Else search down (skipping _*, node_modules, .git, dist, tmp, trash, .worktrees, .claude).
 *   3. If 0 found → walk up for an enclosing root; found → single; else → none.
 *   4. If 1 found → single.
 *   5. If >1 found + model key given → filter; 1 match → single; 0 → no-match; >1 → many.
 *   6. If >1 found + no model key → many.
 */
export async function resolveModel(
  base: string,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const { model: modelKey, ceiling } = opts;
  const absBase = resolve(base);

  // Step 1: base itself is a model root
  if (existsSync(join(absBase, 'ignatius.yml'))) {
    return { kind: 'single', model: makeCandidate(absBase, absBase) };
  }

  // Step 2: search down
  const candidates: ModelCandidate[] = [];
  searchDown(absBase, absBase, candidates);

  // Step 3: nothing below → walk up
  if (candidates.length === 0) {
    const found = walkUp(absBase, ceiling);
    if (found === null) return { kind: 'none' };
    // The enclosing root's key is relative to itself (empty string), but since the
    // base was inside it, we use the root dir as-is and key relative to the root.
    return { kind: 'single', model: makeCandidate(found, found) };
  }

  // Step 4: exactly 1
  if (candidates.length === 1) {
    const only = candidates[0];
    // Guard is unreachable at runtime (length===1 guarantees element exists), but
    // noUncheckedIndexedAccess makes candidates[0] typed as T|undefined — kept to
    // avoid a non-null assertion (!), which is forbidden by project rules.
    if (only === undefined) return { kind: 'none' };
    return { kind: 'single', model: only };
  }

  // Step 5 / 6: multiple candidates
  if (modelKey !== undefined) {
    const matches = candidates.filter(c => c.key === modelKey);
    if (matches.length === 1) {
      const match = matches[0];
      if (match === undefined) return { kind: 'none' }; // unreachable guard
      return { kind: 'single', model: match };
    }
    if (matches.length === 0) return { kind: 'no-match', available: candidates };
    // >1 match (ambiguous even after filter)
    return { kind: 'many', models: matches };
  }

  return { kind: 'many', models: candidates };
}
