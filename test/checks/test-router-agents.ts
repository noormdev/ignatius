/**
 * test-router-agents.ts — `ignatius index --agents` guidance files against a
 * disposable copy of models/key-inherited (spec SC10–SC12).
 *
 * Covers: AGENTS.md/SKILL.md/CLAUDE.md land in the model root; CLAUDE.md
 * appears only when the harness resolves to Claude, not under
 * `harness: agents`; a hand-written CLAUDE.md survives outside its region;
 * SKILL.md frontmatter parses with a model-specific description; nothing is
 * written outside the model root; every guidance file stays under 200 lines;
 * no entity name leaks into a guidance file; a second `--agents` run is
 * byte-identical.
 */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildRouters } from '../../src/router/build';
import { resolveHarness } from '../../src/router/detect';
import { writeGuidance, deriveKeyStyle } from '../../src/router/agents';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const SOURCE_MODEL = `${ROOT}/models/key-inherited`;
const WORK_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/key-inherited');
const GUIDANCE_FILES = ['AGENTS.md', 'SKILL.md', 'CLAUDE.md'];

rmSync(resolve(ROOT, 'tmp/fixtures/router-agents-test'), { recursive: true, force: true });
mkdirSync(resolve(ROOT, 'tmp/fixtures/router-agents-test'), { recursive: true });
cpSync(SOURCE_MODEL, WORK_DIR, { recursive: true });

async function parseAndRoute(dir: string) {
  const { model, globalErrors } = await parseModels(dir);
  const { flowModel, globalErrors: flowErrors } = await parseFlows(dir);
  const allErrors = [...globalErrors, ...flowErrors];
  const routers = await buildRouters(dir, model, flowModel);
  const indexFile = model._meta?.indexFile ?? 'index.md';
  const rootFile = routers.find(f => f.relPath === indexFile);
  assert(!!rootFile, `FAIL: setup — no root router found for ${dir}`);
  return { model, allErrors, rootDigest: rootFile!.digest };
}

function listAllFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAllFiles(path));
    else out.push(path);
  }
  return out;
}

// --- WORK_DIR sits inside the repo tree, which carries its own ancestor
// .claude/ + CLAUDE.md, so `harness: auto` here proves the positive case.
{
  const { model, allErrors, rootDigest } = await parseAndRoute(WORK_DIR);
  assert(allErrors.length === 0, `FAIL: unexpected parse errors before --agents: ${JSON.stringify(allErrors)}`);

  const writeClaude = resolveHarness(WORK_DIR, model._meta?.harness);
  assert(writeClaude, 'FAIL: expected harness: auto to detect Claude via the repo ancestor .claude/');
  await writeGuidance(WORK_DIR, model, rootDigest, writeClaude);

  for (const name of GUIDANCE_FILES) {
    let exists = true;
    try {
      readFileSync(`${WORK_DIR}/${name}`, 'utf8');
    } catch {
      exists = false;
    }
    assert(exists, `FAIL: expected ${name} in the model root`);
  }
}
console.log('PASS: AGENTS.md, SKILL.md, and CLAUDE.md all land in the model root under harness: auto with Claude detected');

// --- isolated dir with no ancestor .claude/ or CLAUDE.md: auto resolves to no Claude ---
{
  const ISOLATED_DIR = join(tmpdir(), `ignatius-agents-isolated-${process.pid}`);
  rmSync(ISOLATED_DIR, { recursive: true, force: true });
  mkdirSync(ISOLATED_DIR, { recursive: true });
  cpSync(SOURCE_MODEL, ISOLATED_DIR, { recursive: true });

  const { model, allErrors, rootDigest } = await parseAndRoute(ISOLATED_DIR);
  assert(allErrors.length === 0, `FAIL: unexpected parse errors in isolated fixture: ${JSON.stringify(allErrors)}`);

  const writeClaude = resolveHarness(ISOLATED_DIR, model._meta?.harness);
  assert(!writeClaude, 'FAIL: expected harness: auto to resolve to no Claude with no ancestor marker');
  await writeGuidance(ISOLATED_DIR, model, rootDigest, writeClaude);

  let claudeExists = true;
  try {
    readFileSync(`${ISOLATED_DIR}/CLAUDE.md`, 'utf8');
  } catch {
    claudeExists = false;
  }
  assert(!claudeExists, 'FAIL: CLAUDE.md must not be written when auto resolves to no Claude');

  for (const name of ['AGENTS.md', 'SKILL.md']) {
    let exists = true;
    try {
      readFileSync(`${ISOLATED_DIR}/${name}`, 'utf8');
    } catch {
      exists = false;
    }
    assert(exists, `FAIL: expected ${name} even with no Claude detected`);
  }

  rmSync(ISOLATED_DIR, { recursive: true, force: true });
}
console.log('PASS: harness: auto resolves to no Claude with no ancestor .claude/ or CLAUDE.md, but still writes AGENTS.md/SKILL.md');

// --- harness: agents forces no CLAUDE.md, even inside the repo tree ---
{
  assert(resolveHarness(WORK_DIR, 'agents') === false, 'FAIL: harness: agents must never write CLAUDE.md');
  assert(resolveHarness(WORK_DIR, 'claude') === true, 'FAIL: harness: claude must always write CLAUDE.md');
  assert(resolveHarness(WORK_DIR, 'both') === true, 'FAIL: harness: both must always write CLAUDE.md');
}
console.log('PASS: harness: agents/claude/both resolve without consulting the ancestor probe');

// --- a hand-written CLAUDE.md survives --agents verbatim outside its region ---
{
  const HANDWRITTEN_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/handwritten-claude');
  rmSync(HANDWRITTEN_DIR, { recursive: true, force: true });
  cpSync(SOURCE_MODEL, HANDWRITTEN_DIR, { recursive: true });
  const handwritten = '# My Project\n\nUnrelated project instructions that must survive.\n';
  writeFileSync(`${HANDWRITTEN_DIR}/CLAUDE.md`, handwritten);

  const { model, rootDigest } = await parseAndRoute(HANDWRITTEN_DIR);
  await writeGuidance(HANDWRITTEN_DIR, model, rootDigest, true);

  const after = readFileSync(`${HANDWRITTEN_DIR}/CLAUDE.md`, 'utf8');
  assert(after.startsWith(handwritten), `FAIL: hand-written CLAUDE.md content must survive verbatim, got:\n${after}`);
  assert(after.includes('@AGENTS.md'), `FAIL: expected the generated shim to import AGENTS.md, got:\n${after}`);
}
console.log('PASS: a hand-written CLAUDE.md survives --agents verbatim, with the shim appended');

// --- SKILL.md frontmatter parses and names this model specifically ---
{
  const skillContent = readFileSync(`${WORK_DIR}/SKILL.md`, 'utf8');
  const match = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(!!match, `FAIL: SKILL.md must open with a YAML frontmatter block, got:\n${skillContent}`);
  const frontmatter = parseYaml(match![1]!);
  assert(typeof frontmatter.name === 'string' && frontmatter.name.length > 0, 'FAIL: SKILL.md frontmatter must carry a non-empty name');
  assert(typeof frontmatter.description === 'string' && frontmatter.description.length > 0, 'FAIL: SKILL.md frontmatter must carry a non-empty description');
  assert(
    frontmatter.description.includes('Key-Inherited'),
    `FAIL: expected the description to mention this model by name, got: ${frontmatter.description}`,
  );
}
console.log('PASS: SKILL.md frontmatter parses and its description names this model specifically');

// --- nothing is written outside the model root ---
{
  const PARENT_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test');
  const before = new Set(listAllFiles(PARENT_DIR).filter(f => !f.startsWith(WORK_DIR) && !f.includes('handwritten-claude')));

  const { model, rootDigest } = await parseAndRoute(WORK_DIR);
  await writeGuidance(WORK_DIR, model, rootDigest, true);

  const after = new Set(listAllFiles(PARENT_DIR).filter(f => !f.startsWith(WORK_DIR) && !f.includes('handwritten-claude')));
  assert(before.size === after.size, `FAIL: files appeared outside the model root: before ${before.size}, after ${after.size}`);
  for (const f of after) assert(before.has(f), `FAIL: unexpected file written outside the model root: ${f}`);
}
console.log('PASS: --agents writes nothing outside the model root');

// --- each guidance file stays under 200 lines ---
{
  for (const name of GUIDANCE_FILES) {
    const content = readFileSync(`${WORK_DIR}/${name}`, 'utf8');
    const lineCount = content.split(/\r?\n/).length;
    assert(lineCount < 200, `FAIL: ${name} has ${lineCount} lines, expected under 200`);
  }
}
console.log('PASS: every guidance file stays under 200 lines');

// --- no entity name from the model appears in any guidance file ---
{
  const { model } = await parseAndRoute(WORK_DIR);
  for (const name of GUIDANCE_FILES) {
    const content = readFileSync(`${WORK_DIR}/${name}`, 'utf8');
    for (const node of model.nodes) {
      assert(!content.includes(node.id), `FAIL: entity name "${node.id}" leaked into ${name}:\n${content}`);
    }
  }
}
console.log('PASS: no entity name from the model appears in any guidance file');

// --- running --agents twice is byte-identical ---
{
  const { model, rootDigest } = await parseAndRoute(WORK_DIR);
  const before = new Map<string, string>();
  for (const name of GUIDANCE_FILES) before.set(name, readFileSync(`${WORK_DIR}/${name}`, 'utf8'));

  await writeGuidance(WORK_DIR, model, rootDigest, true);

  for (const name of GUIDANCE_FILES) {
    const after = readFileSync(`${WORK_DIR}/${name}`, 'utf8');
    assert(before.get(name) === after, `FAIL: ${name} was not byte-identical across an unchanged --agents rerun`);
  }
}
console.log('PASS: running --agents twice is byte-identical');

// --- deriveKeyStyle classifies on PK shape, not edge identifying-ness ---
// key-inherited has non-identifying edges into its reference tables
// (SI_Line -> LineItemType, Party -> PartyType, etc.) — that's normal for a
// healthy key-inherited model, not a deviation from it, so it must still
// resolve to key-inherited rather than mixed.
{
  const KEY_INHERITED_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/key-style-key-inherited');
  rmSync(KEY_INHERITED_DIR, { recursive: true, force: true });
  cpSync(`${ROOT}/models/key-inherited`, KEY_INHERITED_DIR, { recursive: true });
  const { model } = await parseModels(KEY_INHERITED_DIR);
  assert(
    deriveKeyStyle(model.nodes, model.edges) === 'key-inherited',
    `FAIL: expected models/key-inherited to derive key-inherited, got ${deriveKeyStyle(model.nodes, model.edges)}`,
  );
}
console.log('PASS: deriveKeyStyle resolves models/key-inherited to key-inherited despite non-identifying edges into reference tables');

{
  const ORM_PURE_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/key-style-orm-pure');
  rmSync(ORM_PURE_DIR, { recursive: true, force: true });
  cpSync(`${ROOT}/models/orm-pure`, ORM_PURE_DIR, { recursive: true });
  const { model } = await parseModels(ORM_PURE_DIR);
  assert(
    deriveKeyStyle(model.nodes, model.edges) === 'orm-oriented',
    `FAIL: expected models/orm-pure to derive orm-oriented, got ${deriveKeyStyle(model.nodes, model.edges)}`,
  );
}
console.log('PASS: deriveKeyStyle resolves models/orm-pure to orm-oriented');

// orm-hybrid pairs a surrogate `id` PK on every entity with alternate-key
// uniqueness constraints for natural business keys — the hybrid quality
// lives in its AKs, not its PKs, so PK shape alone correctly reports
// orm-oriented rather than mixed.
{
  const ORM_HYBRID_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/key-style-orm-hybrid');
  rmSync(ORM_HYBRID_DIR, { recursive: true, force: true });
  cpSync(`${ROOT}/models/orm-hybrid`, ORM_HYBRID_DIR, { recursive: true });
  const { model } = await parseModels(ORM_HYBRID_DIR);
  assert(
    deriveKeyStyle(model.nodes, model.edges) === 'orm-oriented',
    `FAIL: expected models/orm-hybrid to derive orm-oriented, got ${deriveKeyStyle(model.nodes, model.edges)}`,
  );
}
console.log('PASS: deriveKeyStyle resolves models/orm-hybrid to orm-oriented (hybrid quality is in its AKs, not its PKs)');

// llm-memory-db-mssql was reverse-engineered from a real SQL Server schema
// with base entities on surrogate `<entity>_id` IDENTITY keys and every
// subtype/associative table migrating its parent's key in. The discriminator
// is structural (is this entity the source of an identifying edge?), not the
// literal column name `id`, so both signatures register and the model reads
// as mixed rather than pure key-inherited.
{
  const MIXED_DIR = resolve(ROOT, 'tmp/fixtures/router-agents-test/key-style-mixed');
  rmSync(MIXED_DIR, { recursive: true, force: true });
  cpSync(`${ROOT}/models/llm-memory-db-mssql`, MIXED_DIR, { recursive: true });
  const { model } = await parseModels(MIXED_DIR);
  assert(
    deriveKeyStyle(model.nodes, model.edges) === 'mixed',
    `FAIL: expected models/llm-memory-db-mssql to derive mixed, got ${deriveKeyStyle(model.nodes, model.edges)}`,
  );
}
console.log('PASS: deriveKeyStyle resolves models/llm-memory-db-mssql to mixed (surrogate `_id` PKs plus migrated subtype/associative keys)');

console.log('test-router-agents: OK');
