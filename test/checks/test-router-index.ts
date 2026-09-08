/**
 * test-router-index.ts — end-to-end router generation against a disposable
 * copy of models/key-inherited (spec SC5–SC8).
 *
 * Covers: every organizing folder gets a router; kinds come from the parsed
 * model, never re-derived; a second run is byte-identical; a hand-authored
 * <ignatius-rules> block survives; links name files and are relative; the
 * breadcrumb line is present above the region and doesn't accumulate
 * duplicates when reworded; a folder digest never leaks into a sibling's
 * (SC7 negative); the Description column renders real entity/group text;
 * every row's link resolves to a real file (SC5a); a flat data/ layout
 * (entities directly under data/, group not a folder) indexes without
 * throwing.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { buildRouters } from '../../src/router/build';
import { writeRouters } from '../../src/router/write';
import { hashFile } from '../../src/router/fingerprint';
import { assert } from '../assert';
import type { RouterFile } from '../../src/router/build';

function assertRowLinksResolve(baseDir: string, routers: RouterFile[]): void {
  for (const file of routers) {
    const routerDir = file.relPath.includes('/') ? file.relPath.slice(0, file.relPath.lastIndexOf('/')) : '';
    const rows = file.table.split('\n').slice(2);
    for (const row of rows) {
      const match = row.match(/\(([^)]+)\)\s*\|\s*$/);
      assert(!!match, `FAIL: could not parse the Go-column link from row: ${row}`);
      const link = match![1]!;
      const linkedPath = routerDir === '' ? `${baseDir}/${link}` : `${baseDir}/${routerDir}/${link}`;
      let exists = true;
      try {
        readFileSync(linkedPath, 'utf8');
      } catch {
        exists = false;
      }
      assert(exists, `FAIL: router ${file.relPath} row link "${link}" does not resolve to a real file at ${linkedPath}`);
    }
  }
}

const ROOT = resolve(import.meta.dir, '../..');
const SOURCE_MODEL = `${ROOT}/models/key-inherited`;
const WORK_DIR = resolve(ROOT, 'tmp/fixtures/router-index-test/key-inherited');

rmSync(resolve(ROOT, 'tmp/fixtures/router-index-test'), { recursive: true, force: true });
mkdirSync(resolve(ROOT, 'tmp/fixtures/router-index-test'), { recursive: true });
cpSync(SOURCE_MODEL, WORK_DIR, { recursive: true });

async function parse() {
  const { model, globalErrors } = await parseModels(WORK_DIR);
  const { flowModel, globalErrors: flowErrors } = await parseFlows(WORK_DIR);
  return { model, flowModel, allErrors: [...globalErrors, ...flowErrors] };
}

const first = await parse();
assert(first.allErrors.length === 0, `FAIL: unexpected parse errors before indexing: ${JSON.stringify(first.allErrors)}`);

const firstRouters = await buildRouters(WORK_DIR, first.model, first.flowModel);
await writeRouters(WORK_DIR, firstRouters);

// --- every expected folder gets a router ---
const expectedRelPaths = [
  'index.md',
  'groups/index.md',
  'data/index.md',
  'data/identity/index.md',
  'data/catalog/index.md',
  'data/transactional/index.md',
  'data/reference/index.md',
  'flows/index.md',
  'flows/order-to-cash/index.md',
  'flows/order-to-cash/Create-Sales-Order/index.md',
  'flows/refund/index.md',
  'externals/index.md',
  'stores/index.md',
];
for (const relPath of expectedRelPaths) {
  const path = `${WORK_DIR}/${relPath}`;
  let exists = true;
  try {
    readFileSync(path, 'utf8');
  } catch {
    exists = false;
  }
  assert(exists, `FAIL: expected router at ${relPath}`);
}
console.log(`PASS: every expected folder (${expectedRelPaths.length}) got a router`);

assertRowLinksResolve(WORK_DIR, firstRouters);
console.log('PASS: every row link in every generated router resolves to a real file on disk');

// --- kinds come from the parsed model, not re-derived ---
{
  const identityContent = readFileSync(`${WORK_DIR}/data/identity/index.md`, 'utf8');
  const partyNode = first.model.nodes.find(n => n.id === 'Party');
  assert(!!partyNode, 'FAIL: Party node missing from parsed model');
  assert(
    identityContent.includes(`| Party | ${partyNode!.classification} |`),
    `FAIL: expected Party row to carry classification "${partyNode!.classification}", got:\n${identityContent}`,
  );

  const flowsContent = readFileSync(`${WORK_DIR}/flows/order-to-cash/index.md`, 'utf8');
  assert(
    flowsContent.includes('| Create-Sales-Order | process |') || flowsContent.includes('| Create-Sales-Order | folder |'),
    `FAIL: expected a Create-Sales-Order row in the order-to-cash router, got:\n${flowsContent}`,
  );

  const externalsContent = readFileSync(`${WORK_DIR}/externals/index.md`, 'utf8');
  assert(
    externalsContent.includes('| Customer | external |'),
    `FAIL: expected Customer row with Kind "external", got:\n${externalsContent}`,
  );

  const storesContent = readFileSync(`${WORK_DIR}/stores/index.md`, 'utf8');
  assert(
    /\| \S+ \| store \|/.test(storesContent),
    `FAIL: expected at least one row with Kind "store", got:\n${storesContent}`,
  );
}
console.log('PASS: row kinds come from the parsed model');

// --- links name files and are relative, never a bare folder or a wikilink ---
{
  const dataContent = readFileSync(`${WORK_DIR}/data/index.md`, 'utf8');
  assert(!/\[[^\]]+\]\([^)]*\/\)/.test(dataContent), `FAIL: a router link must not be a bare folder link, got:\n${dataContent}`);
  assert(!/\[\[[^\]]+\]\]/.test(dataContent), `FAIL: a router must not use wikilink syntax, got:\n${dataContent}`);
  assert(dataContent.includes('[identity](identity/index.md)'), `FAIL: expected a file-naming relative link to identity/index.md, got:\n${dataContent}`);
}
console.log('PASS: links name files and are relative');

// --- root section rows all carry a non-empty Description ---
{
  const rootContent = readFileSync(`${WORK_DIR}/index.md`, 'utf8');
  const sectionRows = rootContent.split('\n').filter(l => /^\| (Groups|Data|Flows|Externals|Stores) \| folder \|/.test(l));
  assert(sectionRows.length === 5, `FAIL: expected 5 root section rows, got:\n${rootContent}`);
  for (const row of sectionRows) {
    const description = row.split('|')[3]?.trim() ?? '';
    assert(description !== '', `FAIL: expected a non-empty Description cell, got row: ${row}`);
  }
}
console.log('PASS: root section rows all carry a non-empty Description');

// --- counts in the section descriptions match the parsed model ---
{
  const rootContent = readFileSync(`${WORK_DIR}/index.md`, 'utf8');
  const entityCount = first.model.nodes.length;
  const groupCount = Object.keys(first.model.groups).length;
  assert(rootContent.includes(`${entityCount} entities`), `FAIL: expected the Data description to cite ${entityCount} entities, got:\n${rootContent}`);
  assert(rootContent.includes(`${groupCount} groups`), `FAIL: expected a group count of ${groupCount}, got:\n${rootContent}`);
  assert(rootContent.includes('2 flows') && rootContent.includes('6 processes'), `FAIL: expected the Flows description to cite 2 flows, 6 processes, got:\n${rootContent}`);
  assert(rootContent.includes('1 external'), `FAIL: expected the Externals description to cite 1 external, got:\n${rootContent}`);
  assert(rootContent.includes('1 store'), `FAIL: expected the Stores description to cite 1 store, got:\n${rootContent}`);
}
console.log('PASS: section description counts match the parsed model');

// --- no model description => no stray blank paragraph above the table ---
{
  const rootContent = readFileSync(`${WORK_DIR}/index.md`, 'utf8');
  assert(first.model._meta?.desc === undefined, 'FAIL: setup — key-inherited unexpectedly carries a model description');
  const regionMatch = rootContent.match(/<ignatius-index[^>]*>\r?\n\r?\n([\s\S]*?)\r?\n\r?\n<\/ignatius-index>/);
  assert(!!regionMatch, `FAIL: could not find the <ignatius-index> region in:\n${rootContent}`);
  assert(
    regionMatch![1]!.startsWith('| Name | Kind | Description | Go |'),
    `FAIL: expected the region to open directly with the table when there is no model description, got:\n${regionMatch![1]}`,
  );
}
console.log('PASS: absent model description leaves no stray blank paragraph above the table');

// --- a model description renders as prose above the table, and parses as a real table ---
{
  const DESC_DIR = resolve(ROOT, 'tmp/fixtures/router-index-test/llm-memory-db-mssql');
  rmSync(DESC_DIR, { recursive: true, force: true });
  cpSync(`${ROOT}/models/llm-memory-db-mssql`, DESC_DIR, { recursive: true });

  const { model: descModel, globalErrors: descParseErrors } = await parseModels(DESC_DIR);
  const { flowModel: descFlowModel, globalErrors: descFlowErrors } = await parseFlows(DESC_DIR);
  assert([...descParseErrors, ...descFlowErrors].length === 0, 'FAIL: unexpected parse errors in llm-memory-db-mssql fixture');
  assert(!!descModel._meta?.desc, 'FAIL: setup — llm-memory-db-mssql is expected to carry a model description');

  const descRouters = await buildRouters(DESC_DIR, descModel, descFlowModel);
  await writeRouters(DESC_DIR, descRouters);

  const descRootContent = readFileSync(`${DESC_DIR}/index.md`, 'utf8');
  const regionMatch = descRootContent.match(/<ignatius-index[^>]*>\r?\n\r?\n([\s\S]*?)\r?\n\r?\n<\/ignatius-index>/);
  assert(!!regionMatch, `FAIL: could not find the <ignatius-index> region in:\n${descRootContent}`);
  const region = regionMatch![1]!;

  assert(region.includes(descModel._meta!.desc!), `FAIL: expected the model description in the root region, got:\n${region}`);
  const descIdx = region.indexOf(descModel._meta!.desc!);
  const tableIdx = region.indexOf('| Name | Kind | Description | Go |');
  assert(descIdx !== -1 && descIdx < tableIdx, `FAIL: expected the description above the table, got:\n${region}`);

  const tableLines = region.slice(tableIdx).split('\n');
  assert(tableLines[1] === '|---|---|---|---|', `FAIL: expected the table separator right after the header, got:\n${region}`);
}
console.log('PASS: a model description renders as prose above the table, and the table still parses');

// --- non-root routers are byte-identical to the pre-fix snapshot ---
{
  const SNAPSHOT_DIR = resolve(ROOT, 'tmp/fixtures/router-index-test/snapshot-key-inherited');
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  cpSync(SOURCE_MODEL, SNAPSHOT_DIR, { recursive: true });

  const { model: snapModel } = await parseModels(SNAPSHOT_DIR);
  const { flowModel: snapFlowModel } = await parseFlows(SNAPSHOT_DIR);
  const snapRouters = await buildRouters(SNAPSHOT_DIR, snapModel, snapFlowModel);
  await writeRouters(SNAPSHOT_DIR, snapRouters);

  const expectedDigests: Record<string, string> = {
    'groups/index.md': 'f667ec73daf1ee3f64746df06b5909b22f399b19b35c2c7a734fcb3e5f43b03d',
    'data/catalog/index.md': '32c2d5f79b6b4639bd53a96b5581de26dc6ad9d57d38ebe37dc6f86afc634198',
    'data/identity/index.md': 'be917abfd12a8e1c42bb3c5de76633f0ae392f5f0a0f3a2b89ab8f1e8364cc68',
    'data/reference/index.md': 'fc611cf29d5df47dcba4e28a153ecede239189c4cfe3db6c69d2aa7ea21497ba',
    'data/transactional/index.md': '21173c18f26eb074c38cd352327bc828042f126b5a780a68820125b707e35584',
    'data/index.md': '21f55c7d894082bcff037c1bf246a71a6ce5b29f847e9e977320cbf5a286a529',
    'flows/order-to-cash/Create-Sales-Order/index.md': '76bedeb8de8efcc612bfb5d82643f1f34d762a082941179b947c404b8d8d32ec',
    'flows/order-to-cash/index.md': '0fb036ffe9c5d3c187964795399e2d727db9ad3ea0f3b74c7c91aeb1588fa2bc',
    'flows/refund/index.md': 'a2fef644871cc49e08e4905a01655f2f0abf2708782869a3430e2e5f1ea36d4f',
    'flows/index.md': 'c58465632cc8f006ba7adb12f64018fa322c80fcc7666474ce7c590b3c2e692f',
    'externals/index.md': 'aa2cd56036f7b8617dfb7c3a1e59d3d3ba10f36b9b929710a0aa858f2271124b',
    'stores/index.md': '9b481adc5a077c6ce4773b63e3cfb825cda4217ea07f27aa2acebe7d3edfffd0',
  };

  for (const file of snapRouters) {
    if (file.attrs.scope === 'root') continue;
    const expected = expectedDigests[file.relPath];
    assert(!!expected, `FAIL: no snapshot digest recorded for ${file.relPath}`);
    const actual = await hashFile(`${SNAPSHOT_DIR}/${file.relPath}`);
    assert(actual === `sha256:${expected}`, `FAIL: ${file.relPath} drifted from the pre-fix snapshot (root-only change expected), got digest ${actual}`);
  }
}
console.log('PASS: non-root routers are byte-identical to the pre-fix snapshot');

// --- breadcrumb present above the region ---
{
  const identityContent = readFileSync(`${WORK_DIR}/data/identity/index.md`, 'utf8');
  assert(
    identityContent.includes('↑ [Data](../index.md) · [Key-Inherited](../../index.md)'),
    `FAIL: expected breadcrumb above the region, got:\n${identityContent}`,
  );
  const crumbIdx = identityContent.indexOf('↑ ');
  const tagIdx = identityContent.indexOf('<ignatius-index');
  assert(crumbIdx !== -1 && crumbIdx < tagIdx, 'FAIL: breadcrumb must sit above the <ignatius-index> region');
}
console.log('PASS: breadcrumb line present above the region');

// --- a hand-authored <ignatius-rules> block survives regeneration ---
{
  const identityPath = `${WORK_DIR}/data/identity/index.md`;
  const before = readFileSync(identityPath, 'utf8');
  const rulesBlock = '<ignatius-rules>\n\n- money columns are decimal, never float\n\n</ignatius-rules>';
  writeFileSync(identityPath, `${before}\n${rulesBlock}\n`);

  const second = await parse();
  const secondRouters = await buildRouters(WORK_DIR, second.model, second.flowModel);
  await writeRouters(WORK_DIR, secondRouters);

  const after = readFileSync(identityPath, 'utf8');
  assert(after.includes(rulesBlock), `FAIL: hand-authored <ignatius-rules> block did not survive regeneration, got:\n${after}`);
}
console.log('PASS: hand-authored <ignatius-rules> block survives regeneration');

// --- a second run over an unchanged model is byte-identical ---
{
  const before = new Map<string, string>();
  for (const relPath of expectedRelPaths) before.set(relPath, readFileSync(`${WORK_DIR}/${relPath}`, 'utf8'));

  const third = await parse();
  const thirdRouters = await buildRouters(WORK_DIR, third.model, third.flowModel);
  await writeRouters(WORK_DIR, thirdRouters);

  for (const relPath of expectedRelPaths) {
    const after = readFileSync(`${WORK_DIR}/${relPath}`, 'utf8');
    assert(before.get(relPath) === after, `FAIL: ${relPath} was not byte-identical across an unchanged rerun`);
  }
}
console.log('PASS: an unchanged rerun is byte-identical');

// --- a hand-reworded breadcrumb does not accumulate duplicates ---
{
  const identityPath = `${WORK_DIR}/data/identity/index.md`;
  const before = readFileSync(identityPath, 'utf8');
  const reworded = before.replace(
    '↑ [Data](../index.md) · [Key-Inherited](../../index.md)',
    '↑ [Data](../index.md)\n· [Key-Inherited](../../index.md) — reworded by a human',
  );
  assert(reworded !== before, 'FAIL: setup — reword did not change the fixture');
  writeFileSync(identityPath, reworded);

  const fourth = await parse();
  const fourthRouters = await buildRouters(WORK_DIR, fourth.model, fourth.flowModel);
  await writeRouters(WORK_DIR, fourthRouters);

  const after = readFileSync(identityPath, 'utf8');
  const crumbTagCount = (after.match(/<ignatius-breadcrumb>/g) ?? []).length;
  assert(
    crumbTagCount === 1,
    `FAIL: expected exactly one <ignatius-breadcrumb> region after a rerun over a reworded breadcrumb, got ${crumbTagCount}:\n${after}`,
  );
  assert(
    after.includes('↑ [Data](../index.md) · [Key-Inherited](../../index.md)') && !after.includes('reworded by a human'),
    `FAIL: reworded breadcrumb text should be reset to the canonical breadcrumb, got:\n${after}`,
  );
}
console.log('PASS: a reworded breadcrumb does not accumulate duplicates');

// --- SC7 negative: editing one folder's entity leaves a sibling folder's digest untouched ---
{
  function digestOf(content: string): string {
    const match = content.match(/<ignatius-index[^>]*\sdigest="([^"]+)"/);
    assert(!!match, `FAIL: no digest attribute found in:\n${content}`);
    return match![1]!;
  }

  const catalogPath = `${WORK_DIR}/data/catalog/index.md`;
  const identityPath = `${WORK_DIR}/data/identity/index.md`;
  const rootPath = `${WORK_DIR}/index.md`;

  const catalogBefore = digestOf(readFileSync(catalogPath, 'utf8'));
  const identityBefore = digestOf(readFileSync(identityPath, 'utf8'));
  const rootBefore = digestOf(readFileSync(rootPath, 'utf8'));

  const partyPath = `${WORK_DIR}/data/identity/Party.md`;
  const partySource = readFileSync(partyPath, 'utf8');
  writeFileSync(partyPath, `${partySource}\n\nA sentence added to change this entity's content hash.\n`);

  const fifth = await parse();
  const fifthRouters = await buildRouters(WORK_DIR, fifth.model, fifth.flowModel);
  await writeRouters(WORK_DIR, fifthRouters);

  const catalogAfter = digestOf(readFileSync(catalogPath, 'utf8'));
  const identityAfter = digestOf(readFileSync(identityPath, 'utf8'));
  const rootAfter = digestOf(readFileSync(rootPath, 'utf8'));

  assert(
    catalogAfter === catalogBefore,
    `FAIL: editing an entity under data/identity must not change data/catalog's digest, got ${catalogBefore} -> ${catalogAfter}`,
  );
  assert(identityAfter !== identityBefore, 'FAIL: editing an entity under data/identity should change data/identity\'s digest');
  assert(rootAfter !== rootBefore, 'FAIL: editing an entity under data/identity should change the root digest');
}
console.log('PASS: a sibling folder digest is unaffected by an edit elsewhere (SC7 negative)');

// --- rendered Description column is proven non-empty, not just wired ---
{
  const partyDescription = 'Canonical identity record for a customer, vendor, or employee.';
  const groupDescription = 'Party identity, subtypes, and ID documents.';

  const partyPath = `${WORK_DIR}/data/identity/Party.md`;
  const partySource = readFileSync(partyPath, 'utf8');
  assert(!partySource.includes('description:'), 'FAIL: setup — Party.md already carries a description');
  writeFileSync(partyPath, partySource.replace('entity: Party\n', `entity: Party\ndescription: "${partyDescription}"\n`));

  const groupPath = `${WORK_DIR}/groups/identity.md`;
  const groupSource = readFileSync(groupPath, 'utf8');
  assert(!groupSource.includes('description:'), 'FAIL: setup — groups/identity.md already carries a description');
  writeFileSync(groupPath, groupSource.replace('color: "#2ea043"\n', `color: "#2ea043"\ndescription: "${groupDescription}"\n`));

  const sixth = await parse();
  const sixthRouters = await buildRouters(WORK_DIR, sixth.model, sixth.flowModel);
  await writeRouters(WORK_DIR, sixthRouters);

  const partyNode = sixth.model.nodes.find(n => n.id === 'Party');
  assert(!!partyNode, 'FAIL: Party node missing from parsed model');
  const identityIndex = readFileSync(`${WORK_DIR}/data/identity/index.md`, 'utf8');
  assert(
    identityIndex.includes(`| Party | ${partyNode!.classification} | ${partyDescription} |`),
    `FAIL: expected Party's row to carry its description, got:\n${identityIndex}`,
  );

  const dataIndex = readFileSync(`${WORK_DIR}/data/index.md`, 'utf8');
  assert(
    dataIndex.includes(`| identity | folder | ${groupDescription} |`),
    `FAIL: expected the identity group row to carry its description, got:\n${dataIndex}`,
  );
}
console.log('PASS: Description column renders non-empty entity and group descriptions');

// --- flat-layout model (broken-demo shape): entities sit directly in data/,
// declaring a group that is not a folder — must index without throwing (SC5a) ---
{
  const FLAT_DIR = resolve(ROOT, 'tmp/fixtures/router-index-test/flat-layout');
  rmSync(FLAT_DIR, { recursive: true, force: true });
  mkdirSync(`${FLAT_DIR}/data`, { recursive: true });
  writeFileSync(
    `${FLAT_DIR}/data/Admin.md`,
    '---\nentity: Admin\ngroup: core\npk:\n  - user_id\ncolumns:\n  user_id:\n    type: integer\n---\n\nAdmin entity.\n',
  );
  writeFileSync(
    `${FLAT_DIR}/data/Guest.md`,
    '---\nentity: Guest\ngroup: core\npk:\n  - session_id\ncolumns:\n  session_id:\n    type: text\n---\n\nGuest entity.\n',
  );

  const { model: flatModel, globalErrors: flatParseErrors } = await parseModels(FLAT_DIR);
  const { flowModel: flatFlowModel, globalErrors: flatFlowErrors } = await parseFlows(FLAT_DIR);
  const flatErrors = [...flatParseErrors, ...flatFlowErrors];
  assert(flatErrors.length === 0, `FAIL: unexpected parse errors in flat-layout fixture: ${JSON.stringify(flatErrors)}`);

  const flatRouters = await buildRouters(FLAT_DIR, flatModel, flatFlowModel);
  await writeRouters(FLAT_DIR, flatRouters);

  const flatDataIndex = readFileSync(`${FLAT_DIR}/data/index.md`, 'utf8');
  assert(flatDataIndex.includes('| Admin |'), `FAIL: expected flat data/index.md to list Admin directly, got:\n${flatDataIndex}`);
  assert(flatDataIndex.includes('| Guest |'), `FAIL: expected flat data/index.md to list Guest directly, got:\n${flatDataIndex}`);
  assert(!flatDataIndex.includes('| core |'), `FAIL: a flat layout must not synthesize a "core" group folder row, got:\n${flatDataIndex}`);

  let coreRouterExists = true;
  try {
    readFileSync(`${FLAT_DIR}/data/core/index.md`, 'utf8');
  } catch {
    coreRouterExists = false;
  }
  assert(!coreRouterExists, 'FAIL: a flat layout must not write a data/core/index.md router');

  assertRowLinksResolve(FLAT_DIR, flatRouters);
}
console.log('PASS: flat-layout model indexes without throwing, listing entities directly in data/index.md');

console.log('test-router-index: OK');
