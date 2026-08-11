/**
 * test-skill-no-repo-paths.ts — the distributed skill may not cite repo paths.
 *
 * `npx skills add https://github.com/noormdev/ignatius --skill ignatius-modeling`
 * copies ONLY `skills/ignatius-modeling/` into the user's `.claude/skills/`. Nothing
 * else from this repository lands on their machine, so a `docs/…`, `src/…`, or
 * `spec/…` path written into SKILL.md or any reference file is a dead link
 * everywhere but here — and Claude will try to Read it before discovering that.
 *
 * Allowed: `references/*` (ships inside the skill) and full https:// URLs.
 *
 * This started as an advisory line in the skill's design doc, which did not hold —
 * the design itself told authors to cite `docs/spec/…` inside SKILL.md. The rule
 * needs to fail a build, not sit in prose.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const SKILL_DIR = join(ROOT, 'skills');

/** Repo directories that exist here but never ship with the skill. */
const REPO_DIRS = ['docs', 'src', 'spec', 'test', 'scripts', 'models', 'assets', 'dist'];

// A path-like token in backticks, in a markdown link target, or bare after
// whitespace — e.g. `docs/spec/x.md`, (docs/guides/y.md), or "see docs/z.md".
const CITATION = new RegExp(String.raw`(?:^|[\s\`(\[])((?:${REPO_DIRS.join('|')})\/[A-Za-z0-9._\-\/]+)`, 'g');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(SKILL_DIR);
assert(files.length > 0, `FAIL: no skill markdown found under ${SKILL_DIR}`);
console.log(`scanning ${files.length} skill file(s) under skills/`);

let offences = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    for (const match of line.matchAll(CITATION)) {
      const cited = match[1];
      if (cited === undefined) continue;
      // A full URL that happens to contain the path is fine — it resolves anywhere.
      const at = match.index ?? 0;
      const before = line.slice(0, at + match[0].length);
      if (/https?:\/\/\S*$/.test(before)) continue;

      offences++;
      assert(false, `FAIL: ${rel}:${i + 1} cites repo path "${cited}" — not installed with the skill. Use a full https:// URL, or move the pointer to the design doc.`);
    }
  });
}

if (offences === 0) {
  console.log('PASS: no repo-path citations in the distributed skill');
}
