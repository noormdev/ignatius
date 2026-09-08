/**
 * test-validate-index.ts — `ignatius validate --index` (spec SC9).
 *
 * Covers: an indexed model reports no drift; editing an entity makes
 * `index.stale` fire naming the affected folder; a never-indexed model is
 * reported entirely stale; plain `validate` does no hashing at all (the
 * `--index` flag is what triggers the work); `--index` writes nothing;
 * `index.stale` is Class B and drives a non-zero exit while `index.orphaned`
 * is Class A and does not; an unreadable router target surfaces
 * `index.unreadable_target` instead of a silent, permanently-clean digest;
 * a mid-line `<ignatius-index` mention is not `index.orphaned`; a column-0
 * `<ignatius-index-legacy digest="...">` tag is not read as the router's own
 * stored digest.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildRouters } from '../../src/router/build';
import { writeRouters } from '../../src/router/write';
import { validateIndex, RULES } from '../../src/model/validate';
import { defaultTheme } from '../../src/theme/theme-defaults';
import { defaultBranding } from '../../src/theme/branding-defaults';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const SOURCE_MODEL = `${ROOT}/models/key-inherited`;
const BASE_TMP = resolve(ROOT, 'tmp/fixtures/validate-index-test');

rmSync(BASE_TMP, { recursive: true, force: true });
mkdirSync(BASE_TMP, { recursive: true });

async function parseAndIndex(dir: string) {
  const { model } = await parseModels(dir);
  const { flowModel } = await parseFlows(dir);
  const routers = await buildRouters(dir, model, flowModel);
  await writeRouters(dir, routers);
  return { model, flowModel, routers };
}

function deleteRouters(dir: string, indexFileName: string): void {
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) {
      deleteRouters(path, indexFileName);
    } else if (entry === indexFileName) {
      rmSync(path);
    }
  }
}

function snapshotTree(dir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  function walk(sub: string): void {
    for (const entry of readdirSync(sub)) {
      const path = `${sub}/${entry}`;
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        snapshot.set(path.slice(dir.length + 1), readFileSync(path, 'utf8'));
      }
    }
  }
  walk(dir);
  return snapshot;
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', `${ROOT}/src/cli/cli.ts`, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), 30_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  return { exitCode, stdout, stderr };
}

// --- (1) an indexed, unmodified model reports no drift ---
{
  const dir = `${BASE_TMP}/clean`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model, flowModel } = await parseAndIndex(dir);

  const result = await validateIndex(dir, model, flowModel);
  const stale = result.globalErrors.filter(e => e.ruleId === 'index.stale');
  assert(stale.length === 0, `FAIL (1): expected no index.stale on a freshly indexed model, got ${JSON.stringify(stale)}`);
  assert(result.entityErrors.length === 0, `FAIL (1): expected no index.orphaned on a freshly indexed model, got ${JSON.stringify(result.entityErrors)}`);
  console.log('PASS (1): an indexed, unmodified model reports no index.stale/index.orphaned');
}

// --- (2) editing one entity makes index.stale fire, naming the affected folder ---
{
  const dir = `${BASE_TMP}/edited`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  await parseAndIndex(dir);

  const partyPath = `${dir}/data/identity/Party.md`;
  writeFileSync(partyPath, `${readFileSync(partyPath, 'utf8')}\n\nA sentence added to change this entity's content hash.\n`);

  const { model } = await parseModels(dir);
  const { flowModel } = await parseFlows(dir);
  const result = await validateIndex(dir, model, flowModel);
  const staleIds = result.globalErrors.filter(e => e.ruleId === 'index.stale').map(e => e.omitted.id);
  assert(staleIds.includes('data/identity/index.md'), `FAIL (2): expected data/identity/index.md among stale routers, got ${JSON.stringify(staleIds)}`);
  console.log('PASS (2): editing an entity makes index.stale fire, naming its folder');
}

// --- (3) a model with no routers at all is reported entirely stale ---
{
  const dir = `${BASE_TMP}/never-indexed`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model } = await parseModels(dir);
  const { flowModel } = await parseFlows(dir);
  const indexFile = model._meta?.indexFile ?? 'index.md';
  deleteRouters(dir, indexFile);

  const routers = await buildRouters(dir, model, flowModel);
  const result = await validateIndex(dir, model, flowModel);
  const stale = result.globalErrors.filter(e => e.ruleId === 'index.stale');
  const allStale = stale.length === routers.length;
  assert(
    allStale,
    `FAIL (3): expected every one of ${routers.length} organizing folders to report index.stale on a never-indexed model, got ${stale.length}`,
  );
  const wroteNothing = !existsSync(`${dir}/${indexFile}`);
  assert(wroteNothing, 'FAIL (3): validateIndex must not write a router even for a never-indexed model');
  if (allStale && wroteNothing) {
    console.log('PASS (3): a never-indexed model is reported entirely stale, and nothing is written');
  }
}

// --- (4) plain `validate` does no hashing; `--index` is what triggers the work ---
{
  const dir = `${BASE_TMP}/flag-gated`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  await parseAndIndex(dir);
  const partyPath = `${dir}/data/identity/Party.md`;
  writeFileSync(partyPath, `${readFileSync(partyPath, 'utf8')}\n\nDirties the digest without touching parse-time validity.\n`);

  const plain = await run(['validate', dir]);
  assert(plain.exitCode === 0, `FAIL (4): plain validate on a stale-but-parseable model should exit 0, got ${plain.exitCode}\n${plain.stderr}`);
  assert(!plain.stderr.includes('index.stale'), `FAIL (4): plain validate must never report index.stale, got:\n${plain.stderr}`);

  const indexed = await run(['validate', dir, '--index']);
  assert(indexed.exitCode === 1, `FAIL (4): validate --index on the same stale model should exit 1, got ${indexed.exitCode}`);
  assert(indexed.stderr.includes('index.stale'), `FAIL (4): validate --index should report index.stale, got:\n${indexed.stderr}`);
  console.log('PASS (4): the --index flag — not model content alone — is what triggers digest checking');
}

// --- (5) `validate --index` writes nothing ---
{
  const dir = `${BASE_TMP}/no-writes`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model, flowModel } = await parseAndIndex(dir);

  const before = snapshotTree(dir);
  await validateIndex(dir, model, flowModel);
  const after = snapshotTree(dir);

  assert(before.size === after.size, `FAIL (5): file count changed after validate --index: ${before.size} -> ${after.size}`);
  for (const [path, content] of before) {
    assert(after.get(path) === content, `FAIL (5): ${path} changed after validate --index (writes nothing)`);
  }
  console.log('PASS (5): validate --index writes nothing (tree snapshot identical before/after)');
}

// --- (6) index.stale is Class B and drives a non-zero exit; index.orphaned is Class A and does not ---
{
  assert(RULES['index.stale'].class === 'B', 'FAIL (6): index.stale must be Class B — --index is opt-in and the fix is one command, so it hard-fails deliberately, not by accident');
  assert(RULES['index.orphaned'].class === 'A', 'FAIL (6): index.orphaned must be Class A — a leftover file warns, it does not fail the build');

  const dir = `${BASE_TMP}/orphaned`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model, flowModel } = await parseAndIndex(dir);

  // Leave behind a router-shaped file under a name the current index_file
  // config no longer produces — simulating the aftermath of an index_file
  // rename without deleting the old file. Placed at the model root: root is
  // not glob-scanned for entity/group/flow frontmatter, so this stays a pure
  // index.orphaned case, uncomplicated by an unrelated parse.invalid_yaml on
  // a leftover file the parser would otherwise mistake for an entity.
  const rootIndex = readFileSync(`${dir}/index.md`, 'utf8');
  writeFileSync(`${dir}/old-index.md`, rootIndex);

  const result = await validateIndex(dir, model, flowModel);
  const stale = result.globalErrors.filter(e => e.ruleId === 'index.stale');
  const orphaned = result.entityErrors.filter(e => e.ruleId === 'index.orphaned');
  assert(stale.length === 0, `FAIL (6): the orphaned leftover must not itself be reported as index.stale, got ${JSON.stringify(stale)}`);
  assert(
    orphaned.some(e => e.entityId === 'old-index.md'),
    `FAIL (6): expected index.orphaned naming old-index.md, got ${JSON.stringify(orphaned)}`,
  );

  const cliResult = await run(['validate', dir, '--index']);
  assert(cliResult.exitCode === 0, `FAIL (6): index.orphaned alone must not drive a non-zero exit, got ${cliResult.exitCode}\n${cliResult.stderr}`);
  assert(cliResult.stderr.includes('index.orphaned'), `FAIL (6): expected an index.orphaned warn line, got:\n${cliResult.stderr}`);
  console.log('PASS (6): index.stale (Class B) hard-fails, index.orphaned (Class A) only warns');
}

// --- (7) an unreadable entity target surfaces index.unreadable_target, not a zero digest ---
{
  const dir = `${BASE_TMP}/unreadable`;
  mkdirSync(dir, { recursive: true });

  const model = {
    groups: {},
    nodes: [{
      id: 'Ghost',
      classification: 'Independent',
      sourcePath: 'data/Ghost.md', // never written to disk
      pk: ['id'],
      columns: {},
      alternateKeys: [],
      bodyHtml: '',
    }],
    edges: [],
    subtypeClusters: [],
    theme: defaultTheme,
    branding: defaultBranding,
  };
  const flowModel = { diagrams: [], modelDir: dir, externals: [], clusters: [] };

  const routers = await buildRouters(dir, model, flowModel);
  const dataRouter = routers.find(r => r.relPath === 'data/index.md');
  assert(!!dataRouter, 'FAIL (7): expected a data/index.md router even with an unreadable target');
  assert(
    dataRouter!.digest !== 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'FAIL (7): an unreadable target must not fall back to the old stable all-zero digest',
  );

  const result = await validateIndex(dir, model, flowModel);
  const unreadableFindings = result.globalErrors.filter(e => e.ruleId === 'index.unreadable_target');
  assert(
    unreadableFindings.some(e => e.omitted.id === `${dir}/data/Ghost.md`),
    `FAIL (7): expected index.unreadable_target naming ${dir}/data/Ghost.md, got ${JSON.stringify(unreadableFindings)}`,
  );
  console.log('PASS (7): an unreadable router target surfaces index.unreadable_target instead of a silent zero digest');
}

// --- (8) a non-router file that merely mentions `<ignatius-index` mid-line
// is not reported as index.orphaned ---
{
  const dir = `${BASE_TMP}/orphaned-mid-line-mention`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model, flowModel } = await parseAndIndex(dir);

  writeFileSync(
    `${dir}/orphaned-mention.md`,
    'Some prose that mentions `<ignatius-index>` as an example, not a real region.\n',
  );

  const result = await validateIndex(dir, model, flowModel);
  const orphaned = result.entityErrors.filter(e => e.ruleId === 'index.orphaned');
  assert(
    !orphaned.some(e => e.entityId === 'orphaned-mention.md'),
    `FAIL (8): a mid-line mention of <ignatius-index must not be reported as index.orphaned, got ${JSON.stringify(orphaned)}`,
  );
  console.log('PASS (8): a mid-line mention of <ignatius-index is not reported as index.orphaned');
}

// --- (9) a column-0 <ignatius-index-legacy digest="..."> tag must not be
// read as the router's own stored digest ---
{
  const dir = `${BASE_TMP}/legacy-tag-name`;
  cpSync(SOURCE_MODEL, dir, { recursive: true });
  const { model, flowModel, routers } = await parseAndIndex(dir);

  const target = routers.find(r => r.relPath === 'data/identity/index.md');
  assert(!!target, 'FAIL (9): expected data/identity/index.md among the built routers');

  // Rename the real router's opening tag to a differently-named tag but keep
  // its true digest as the attribute value — if the digest regex is read
  // matching this tag anyway, the mismatch it should report gets masked.
  const path = `${dir}/data/identity/index.md`;
  const rewritten = readFileSync(path, 'utf8').replace(
    '<ignatius-index ',
    `<ignatius-index-legacy digest="${target!.digest}" `,
  );
  writeFileSync(path, rewritten);

  const result = await validateIndex(dir, model, flowModel);
  const stale = result.globalErrors.filter(e => e.ruleId === 'index.stale' && e.omitted.id === 'data/identity/index.md');
  assert(
    stale.length === 1,
    `FAIL (9): a column-0 <ignatius-index-legacy> tag must not be mistaken for the router's own digest tag, expected index.stale, got ${JSON.stringify(stale)}`,
  );
  console.log('PASS (9): a column-0 <ignatius-index-legacy> tag is not mistaken for the router digest');
}

console.log('test-validate-index: OK');
