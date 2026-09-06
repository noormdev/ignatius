// Verification: index_file/harness config keys, reserved-name scan skip, config rules
// Covers: SC1 (config keys + defaults), SC2 (basename skip), SC3 (three config rules)
import { assert } from '../assert';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { resolve } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/index-config-test');

const MINIMAL_ENTITY = (id: string) => `---
entity: ${id}
pk: [id]
columns:
  id: { type: uuid }
---
`;

function makeFixtureDir(name: string): string {
  const dir = `${BASE_TMP}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/data/identity`, { recursive: true });
  return dir;
}

// --- (a) neither key present — parses, defaults apply ---
{
  const dir = makeFixtureDir('defaults');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { model, globalErrors } = await parseModels(dir);

  assert(globalErrors.length === 0, `FAIL (a): expected no global errors, got ${JSON.stringify(globalErrors)}`);
  const widget = model.nodes[0];
  if (widget === undefined) throw new Error('FAIL (a): expected one node, got none');
  assert(model.nodes.length === 1 && widget.id === 'Widget', 'FAIL (a): Widget should parse');
  console.log('PASS (a): no ignatius.yml — index_file/harness default, model parses clean');
}

// --- (b) explicit index_file + harness land on _meta ---
{
  const dir = makeFixtureDir('explicit-keys');
  writeFileSync(`${dir}/ignatius.yml`, 'index_file: router.md\nharness: claude\n');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { model } = await parseModels(dir);

  assert(model._meta?.indexFile === 'router.md', `FAIL (b): _meta.indexFile = ${model._meta?.indexFile}`);
  assert(model._meta?.harness === 'claude', `FAIL (b): _meta.harness = ${model._meta?.harness}`);
  console.log('PASS (b): index_file + harness load onto _meta');
}

// --- (c) default index_file name: a router named index.md in data/identity/ is skipped, no parse.missing_id ---
{
  const dir = makeFixtureDir('skip-default');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));
  writeFileSync(`${dir}/data/identity/index.md`, '# Identity\n\nJust a router, no frontmatter.\n');

  const { model, globalErrors } = await parseModels(dir);

  assert(globalErrors.length === 0, `FAIL (c): expected no global errors, got ${JSON.stringify(globalErrors)}`);
  const widget = model.nodes[0];
  if (widget === undefined) throw new Error('FAIL (c): expected one node, got none');
  assert(model.nodes.length === 1 && widget.id === 'Widget', 'FAIL (c): only Widget should parse');
  console.log('PASS (c): index.md in data/identity/ is skipped, no parse.missing_id');
}

// --- (d) suffix matching is not used: Reindex.md is still scanned and still raises parse.missing_id ---
{
  const dir = makeFixtureDir('suffix-not-skipped');
  writeFileSync(`${dir}/data/identity/Reindex.md`, '# Not an entity\n\nNo frontmatter at all.\n');

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'parse.empty_frontmatter' || e.ruleId === 'parse.invalid_yaml'),
    `FAIL (d): Reindex.md should still be scanned (and fail parsing), got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS (d): Reindex.md is still scanned — suffix matching is not used');
}

// --- (e) config.index_file_ext fires when index_file does not end in .md ---
{
  const dir = makeFixtureDir('bad-ext');
  writeFileSync(`${dir}/ignatius.yml`, 'index_file: router.txt\n');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'config.index_file_ext'),
    `FAIL (e): expected config.index_file_ext, got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS (e): config.index_file_ext fires on a non-.md value');
}

// --- (f) config.index_file_path fires when index_file contains a path separator or ".." ---
{
  const dir = makeFixtureDir('bad-path');
  writeFileSync(`${dir}/ignatius.yml`, 'index_file: ../router.md\n');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'config.index_file_path'),
    `FAIL (f): expected config.index_file_path, got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS (f): config.index_file_path fires on a value containing ".."');
}

// --- (f2) config.index_file_path also fires on a bare nested path with no ".." ---
{
  const dir = makeFixtureDir('bad-path-nested');
  writeFileSync(`${dir}/ignatius.yml`, 'index_file: sub/router.md\n');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'config.index_file_path'),
    `FAIL (f2): expected config.index_file_path, got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS (f2): config.index_file_path fires on a nested path with no ".."');
}

// --- (g) config.index_file_entity fires when a reserved-name file declares entity:, not parse.missing_id ---
{
  const dir = makeFixtureDir('reserved-entity');
  writeFileSync(`${dir}/data/identity/index.md`, MINIMAL_ENTITY('SneakyEntity'));

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'config.index_file_entity'),
    `FAIL (g): expected config.index_file_entity, got ${JSON.stringify(globalErrors)}`,
  );
  assert(
    !globalErrors.some(e => e.ruleId === 'parse.missing_id'),
    `FAIL (g): parse.missing_id should not fire for a reserved-name file, got ${JSON.stringify(globalErrors)}`,
  );
  const entityFinding = globalErrors.find(e => e.ruleId === 'config.index_file_entity');
  assert(
    entityFinding !== undefined && entityFinding.reason.includes('index.md'),
    `FAIL (g): message should name the reserved filename, got ${JSON.stringify(entityFinding)}`,
  );
  console.log('PASS (g): config.index_file_entity fires, names the reserved filename, not parse.missing_id');
}

// --- (h) parse.invalid_yaml fires when a reserved-name file has malformed YAML frontmatter ---
{
  const dir = makeFixtureDir('reserved-bad-yaml');
  writeFileSync(`${dir}/data/identity/index.md`, '---\nentity: [unclosed\n---\nRouter body.\n');
  writeFileSync(`${dir}/data/identity/Widget.md`, MINIMAL_ENTITY('Widget'));

  const { globalErrors } = await parseModels(dir);

  assert(
    globalErrors.some(e => e.ruleId === 'parse.invalid_yaml'),
    `FAIL (h): expected parse.invalid_yaml for malformed YAML in reserved index file, got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS (h): parse.invalid_yaml fires for malformed YAML in a reserved index file');
}

// --- (i) a reserved-name router in a flows/ diagram folder is skipped, no parse.invalid_yaml ---
{
  const dir = makeFixtureDir('skip-flows-diagram-router');
  mkdirSync(`${dir}/flows/order-to-cash`, { recursive: true });
  writeFileSync(`${dir}/flows/order-to-cash/index.md`, '# Order to Cash\n\nJust a router, no frontmatter.\n');

  const { globalErrors } = await parseFlows(dir);

  assert(globalErrors.length === 0, `FAIL (i): expected no global errors, got ${JSON.stringify(globalErrors)}`);
  console.log('PASS (i): index.md in a flows/ diagram folder is skipped, no parse.invalid_yaml');
}

// --- (j) a reserved-name router in externals/ is skipped, no parse.invalid_yaml ---
{
  const dir = makeFixtureDir('skip-externals-router');
  mkdirSync(`${dir}/externals`, { recursive: true });
  writeFileSync(`${dir}/externals/index.md`, '# Externals\n\nJust a router, no frontmatter.\n');

  const { globalErrors } = await parseFlows(dir);

  assert(globalErrors.length === 0, `FAIL (j): expected no global errors, got ${JSON.stringify(globalErrors)}`);
  console.log('PASS (j): index.md in externals/ is skipped, no parse.invalid_yaml');
}

// --- (k) a reserved-name router in stores/ is skipped, no parse.invalid_yaml ---
{
  const dir = makeFixtureDir('skip-stores-router');
  mkdirSync(`${dir}/stores`, { recursive: true });
  writeFileSync(`${dir}/stores/index.md`, '# Stores\n\nJust a router, no frontmatter.\n');

  const { globalErrors } = await parseFlows(dir);

  assert(globalErrors.length === 0, `FAIL (k): expected no global errors, got ${JSON.stringify(globalErrors)}`);
  console.log('PASS (k): index.md in stores/ is skipped, no parse.invalid_yaml');
}

console.log('All index-config tests passed.');
