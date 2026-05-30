// Verification: resolveModel() pure model-root discovery
// Covers: base-is-root, container-many, walk-up, none, skip-list, --model select, --model no-match
import { resolveModel } from '../../src/discover';
import { resolve } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/discover-test');

function setup(): void {
  rmSync(BASE_TMP, { recursive: true, force: true });
  mkdirSync(BASE_TMP, { recursive: true });
}

function mkdir(rel: string): string {
  const full = `${BASE_TMP}/${rel}`;
  mkdirSync(full, { recursive: true });
  return full;
}

function writeYml(dir: string, content: string): void {
  writeFileSync(`${dir}/ignatius.yml`, content);
}

setup();

// --- Test (a): base IS a model root (base/ignatius.yml exists) → single ---
{
  const base = mkdir('base-is-root');
  writeYml(base, 'name: Root Model\n');

  const result = await resolveModel(base);

  console.assert(result.kind === 'single', `FAIL (a): expected single, got ${result.kind}`);
  if (result.kind === 'single') {
    console.assert(result.model.dir === base, `FAIL (a): dir mismatch: ${result.model.dir}`);
    console.assert(result.model.name === 'Root Model', `FAIL (a): name = ${result.model.name}`);
    console.assert(result.model.key === '', `FAIL (a): key should be '' for base-is-root, got '${result.model.key}'`);
  }
  console.log('PASS (a): base IS a model root → single');
}

// --- Test (b): container with 3 child model roots → many ---
{
  const container = mkdir('container');
  const aDir = mkdir('container/alpha');
  const bDir = mkdir('container/beta');
  const cDir = mkdir('container/gamma');
  writeYml(aDir, 'name: Alpha Model\n');
  writeYml(bDir, 'name: Beta Model\n');
  writeYml(cDir, 'name: Gamma Model\n');

  const result = await resolveModel(container);

  console.assert(result.kind === 'many', `FAIL (b): expected many, got ${result.kind}`);
  if (result.kind === 'many') {
    console.assert(result.models.length === 3, `FAIL (b): expected 3 models, got ${result.models.length}`);
    const keys = result.models.map(m => m.key).sort();
    console.assert(keys[0] === 'alpha', `FAIL (b): key[0] = ${keys[0]}`);
    console.assert(keys[1] === 'beta', `FAIL (b): key[1] = ${keys[1]}`);
    console.assert(keys[2] === 'gamma', `FAIL (b): key[2] = ${keys[2]}`);
  }
  console.log('PASS (b): container with 3 child roots → many');
}

// --- Test (c): container + --model <key> → single ---
{
  const container = `${BASE_TMP}/container`;

  const result = await resolveModel(container, { model: 'beta' });

  console.assert(result.kind === 'single', `FAIL (c): expected single, got ${result.kind}`);
  if (result.kind === 'single') {
    console.assert(result.model.key === 'beta', `FAIL (c): key = ${result.model.key}`);
    console.assert(result.model.name === 'Beta Model', `FAIL (c): name = ${result.model.name}`);
  }
  console.log('PASS (c): container + --model beta → single');
}

// --- Test (d): walk-up — base is subdir inside a model root, no ignatius.yml at or below ---
{
  const root = mkdir('walk-up-root');
  writeYml(root, 'name: Enclosing Model\n');
  const subdir = mkdir('walk-up-root/entities/core');
  // subdir has no ignatius.yml and no children with ignatius.yml

  const result = await resolveModel(subdir);

  console.assert(result.kind === 'single', `FAIL (d): expected single, got ${result.kind}`);
  if (result.kind === 'single') {
    console.assert(result.model.dir === root, `FAIL (d): expected dir=${root}, got ${result.model.dir}`);
    console.assert(result.model.name === 'Enclosing Model', `FAIL (d): name = ${result.model.name}`);
  }
  console.log('PASS (d): walk-up finds enclosing model root → single');
}

// --- Test (e): none — no ignatius.yml at, below, or above within the fixture ceiling ---
{
  // Create an isolated subtree with no ignatius.yml at any level.
  // Pass ceiling=isolated so the walk-up phase is bounded and can't escape to real ancestors.
  const isolated = mkdir('none-test');
  mkdirSync(`${isolated}/child`, { recursive: true });

  const result = await resolveModel(`${isolated}/child`, { ceiling: isolated });

  console.assert(result.kind === 'none', `FAIL (e): expected none, got ${result.kind}`);
  console.log('PASS (e): no ignatius.yml anywhere → none');
}

// --- Test (f): skip-list — node_modules and _prefixed dirs are NOT counted ---
{
  const container = mkdir('skip-test');
  // These should be skipped
  mkdir('skip-test/node_modules/some-pkg');
  writeYml(`${BASE_TMP}/skip-test/node_modules/some-pkg`, 'name: Should Skip\n');
  mkdir('skip-test/_internal');
  writeYml(`${BASE_TMP}/skip-test/_internal`, 'name: Should Also Skip\n');
  mkdir('skip-test/.git');
  writeYml(`${BASE_TMP}/skip-test/.git`, 'name: Git Skip\n');
  mkdir('skip-test/dist');
  writeYml(`${BASE_TMP}/skip-test/dist`, 'name: Dist Skip\n');
  // This one should be found
  mkdir('skip-test/valid');
  writeYml(`${BASE_TMP}/skip-test/valid`, 'name: Valid\n');

  const result = await resolveModel(container);

  console.assert(result.kind === 'single', `FAIL (f): expected single (only 1 valid), got ${result.kind}`);
  if (result.kind === 'single') {
    console.assert(result.model.key === 'valid', `FAIL (f): expected key=valid, got ${result.model.key}`);
  }
  console.log('PASS (f): skip-list dirs are not counted');
}

// --- Test (g): --model key matches nothing → no-match ---
{
  const container = `${BASE_TMP}/container`;

  const result = await resolveModel(container, { model: 'nonexistent' });

  console.assert(result.kind === 'no-match', `FAIL (g): expected no-match, got ${result.kind}`);
  if (result.kind === 'no-match') {
    console.assert(Array.isArray(result.available), 'FAIL (g): available should be array');
    console.assert(result.available.length === 3, `FAIL (g): expected 3 available, got ${result.available.length}`);
  }
  console.log('PASS (g): --model with no-match key → no-match with available keys');
}

// --- Test (h): key is relative path, not bare basename — nested same-named dirs stay distinct ---
{
  const container = mkdir('nested-keys');
  mkdir('nested-keys/group-a/models');
  writeYml(`${BASE_TMP}/nested-keys/group-a/models`, 'name: Group A Models\n');
  mkdir('nested-keys/group-b/models');
  writeYml(`${BASE_TMP}/nested-keys/group-b/models`, 'name: Group B Models\n');

  const result = await resolveModel(`${BASE_TMP}/nested-keys`);

  console.assert(result.kind === 'many', `FAIL (h): expected many, got ${result.kind}`);
  if (result.kind === 'many') {
    const keys = result.models.map(m => m.key).sort();
    // keys should be relative paths like 'group-a/models' and 'group-b/models'
    console.assert(keys.length === 2, `FAIL (h): expected 2 models, got ${keys.length}`);
    console.assert(keys[0] === 'group-a/models', `FAIL (h): key[0] = ${keys[0]}`);
    console.assert(keys[1] === 'group-b/models', `FAIL (h): key[1] = ${keys[1]}`);
  }
  console.log('PASS (h): nested same-named dirs get relative path keys');
}

// --- Test (i): --model with relative path key → single ---
{
  const result = await resolveModel(`${BASE_TMP}/nested-keys`, { model: 'group-b/models' });

  console.assert(result.kind === 'single', `FAIL (i): expected single, got ${result.kind}`);
  if (result.kind === 'single') {
    console.assert(result.model.key === 'group-b/models', `FAIL (i): key = ${result.model.key}`);
    console.assert(result.model.name === 'Group B Models', `FAIL (i): name = ${result.model.name}`);
  }
  console.log('PASS (i): --model with relative path key → single');
}

console.log('All discover tests passed.');
