// Verification: parseModels returns { model, globalErrors } and handles parse-time failures
// per-file without rejecting the entire promise.
//
// Rules covered: parse.invalid_yaml, parse.missing_id, parse.empty_frontmatter
//
// Approach: build temporary fixture dirs under tmp/ (gitignored),
// include one malformed file + one valid file per scenario,
// assert globalErrors contains the expected ruleId and the bad file is absent from model.nodes.
import { parseModels } from '../../src/parse';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid entity frontmatter + body */
const VALID_ENTITY = `---
entity: GoodEntity
classification: independent
pk:
  - id
columns:
  id:
    type: uuid
---

Body text.
`;

async function makeTmpDir(): Promise<string> {
    const base = join(import.meta.dir, '../../tmp');
    // Ensure tmp/ exists (gitignored)
    await Bun.write(join(base, '.gitkeep'), '');
    const dir = await mkdtemp(join(base, 'parse-globals-'));
    // _groups/ must exist for the groups glob scan to succeed
    await Bun.write(join(dir, '_groups', '.gitkeep'), '');
    return dir;
}

async function cleanup(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Return shape: { model, globalErrors }
// ---------------------------------------------------------------------------

{
    // Baseline: valid directory returns the correct shape with zero globalErrors
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'GoodEntity.md'), VALID_ENTITY);
        const result = await parseModels(dir);

        // Must have both keys
        console.assert('model' in result, 'FAIL: parseModels return missing "model" key');
        console.assert('globalErrors' in result, 'FAIL: parseModels return missing "globalErrors" key');
        console.assert(Array.isArray(result.globalErrors), 'FAIL: globalErrors is not an array');
        console.assert(result.globalErrors.length === 0, `FAIL: baseline has unexpected globalErrors: ${JSON.stringify(result.globalErrors)}`);
        console.assert(result.model.nodes.length === 1, `FAIL: baseline model should have 1 node, got ${result.model.nodes.length}`);
        console.assert(result.model.nodes[0]!.id === 'GoodEntity', 'FAIL: baseline node id mismatch');
        console.log('PASS: parseModels returns { model, globalErrors } shape with zero errors for valid dir');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// parse.invalid_yaml
// ---------------------------------------------------------------------------

{
    // Malformed YAML: unclosed bracket causes parse to throw
    const invalidYaml = `---
entity: BadYaml
pk: [unclosed
---

Body.
`;
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'GoodEntity.md'), VALID_ENTITY);
        await Bun.write(join(dir, 'BadYaml.md'), invalidYaml);

        const { model, globalErrors } = await parseModels(dir);

        // Good file still parses
        console.assert(model.nodes.length === 1, `FAIL: parse.invalid_yaml — good entity not in model (nodes: ${model.nodes.map(n => n.id).join(',')})`);
        console.assert(model.nodes[0]!.id === 'GoodEntity', 'FAIL: parse.invalid_yaml — good entity id mismatch');

        // Bad file emits GlobalError
        console.assert(globalErrors.length === 1, `FAIL: parse.invalid_yaml — expected 1 globalError, got ${globalErrors.length}`);
        console.assert(globalErrors[0]!.ruleId === 'parse.invalid_yaml', `FAIL: parse.invalid_yaml — wrong ruleId: ${globalErrors[0]!.ruleId}`);
        console.assert(globalErrors[0]!.severity === 'error', 'FAIL: parse.invalid_yaml — severity should be error');
        console.assert(globalErrors[0]!.omitted.kind === 'entity', 'FAIL: parse.invalid_yaml — omitted.kind should be entity');
        console.log('PASS: parse.invalid_yaml — malformed YAML captured in globalErrors, good entity still in model');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// parse.missing_id
// ---------------------------------------------------------------------------

{
    // Frontmatter missing 'entity' field
    const missingId = `---
classification: independent
pk:
  - id
columns:
  id:
    type: uuid
---

Body.
`;
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'GoodEntity.md'), VALID_ENTITY);
        await Bun.write(join(dir, 'NoId.md'), missingId);

        const { model, globalErrors } = await parseModels(dir);

        console.assert(model.nodes.length === 1, `FAIL: parse.missing_id — good entity not in model (nodes: ${model.nodes.map(n => n.id).join(',')})`);
        console.assert(globalErrors.length === 1, `FAIL: parse.missing_id — expected 1 globalError, got ${globalErrors.length}`);
        console.assert(globalErrors[0]!.ruleId === 'parse.missing_id', `FAIL: parse.missing_id — wrong ruleId: ${globalErrors[0]!.ruleId}`);
        console.assert(globalErrors[0]!.severity === 'error', 'FAIL: parse.missing_id — severity should be error');
        console.assert(globalErrors[0]!.omitted.kind === 'entity', 'FAIL: parse.missing_id — omitted.kind should be entity');
        console.log('PASS: parse.missing_id — file with no entity field captured in globalErrors, good entity still in model');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// parse.empty_frontmatter
// ---------------------------------------------------------------------------

{
    // Empty YAML fences — the frontmatter section contains only whitespace.
    // parseFrontmatter matches ---\n(empty)\n---\n so frontmatter is null.
    const emptyFrontmatter = `---

---

Body.
`;
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'GoodEntity.md'), VALID_ENTITY);
        await Bun.write(join(dir, 'EmptyFm.md'), emptyFrontmatter);

        const { model, globalErrors } = await parseModels(dir);

        console.assert(model.nodes.length === 1, `FAIL: parse.empty_frontmatter — good entity not in model (nodes: ${model.nodes.map(n => n.id).join(',')})`);
        console.assert(globalErrors.length === 1, `FAIL: parse.empty_frontmatter — expected 1 globalError, got ${globalErrors.length}`);
        console.assert(globalErrors[0]!.ruleId === 'parse.empty_frontmatter', `FAIL: parse.empty_frontmatter — wrong ruleId: ${globalErrors[0]!.ruleId}`);
        console.assert(globalErrors[0]!.severity === 'error', 'FAIL: parse.empty_frontmatter — severity should be error');
        console.log('PASS: parse.empty_frontmatter — file with empty fences captured in globalErrors, good entity still in model');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// pk defaults to [] and columns defaults to {} when absent in frontmatter
// ---------------------------------------------------------------------------

{
    const noPkNoColumns = `---
entity: Minimal
classification: independent
---

Body.
`;
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'Minimal.md'), noPkNoColumns);
        const { model, globalErrors } = await parseModels(dir);

        console.assert(globalErrors.length === 0, `FAIL: pk/columns defaults — unexpected globalErrors: ${JSON.stringify(globalErrors)}`);
        console.assert(model.nodes.length === 1, 'FAIL: pk/columns defaults — Minimal not in model');
        const node = model.nodes[0]!;
        console.assert(Array.isArray(node.pk), 'FAIL: pk defaults — pk is not an array');
        console.assert(node.pk.length === 0, `FAIL: pk defaults — expected empty array, got ${JSON.stringify(node.pk)}`);
        console.assert(node.columns !== null && typeof node.columns === 'object' && !Array.isArray(node.columns),
            'FAIL: columns defaults — columns is not an object');
        console.assert(Object.keys(node.columns).length === 0, `FAIL: columns defaults — expected empty object, got ${JSON.stringify(node.columns)}`);
        console.log('PASS: pk defaults to [] and columns defaults to {} when absent in frontmatter');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// Classification is derived (PascalCase), not taken from the legacy field
// ---------------------------------------------------------------------------

{
    const pascalCaseClassification = `---
entity: MyEntity
classification: Independent
pk:
  - id
columns:
  id:
    type: uuid
---
`;
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'MyEntity.md'), pascalCaseClassification);
        const { model } = await parseModels(dir);

        // An entity with a single-column pk and no identifying parents derives to
        // 'Independent'. Classification is structural + PascalCase — the legacy
        // `classification:` frontmatter field is not lowercased or echoed.
        console.assert(model.nodes.length === 1, 'FAIL: classification — entity not in model');
        console.assert(model.nodes[0]!.classification === 'Independent',
            `FAIL: classification should derive to 'Independent' (got: ${model.nodes[0]!.classification})`);
        console.log('PASS: classification derived as PascalCase Independent');
    } finally {
        await cleanup(dir);
    }
}

// ---------------------------------------------------------------------------
// Multiple malformed files — promise does not reject; all errors collected
// ---------------------------------------------------------------------------

{
    const dir = await makeTmpDir();
    try {
        await Bun.write(join(dir, 'GoodEntity.md'), VALID_ENTITY);
        await Bun.write(join(dir, 'EmptyFm.md'), `---\n\n---\nBody.\n`);
        await Bun.write(join(dir, 'NoId.md'), `---\nclassification: independent\npk:\n  - id\n---\n`);

        const { model, globalErrors } = await parseModels(dir);

        console.assert(model.nodes.length === 1, `FAIL: multiple malformed — good entity not in model`);
        console.assert(globalErrors.length === 2, `FAIL: multiple malformed — expected 2 globalErrors, got ${globalErrors.length}`);
        const ruleIds = new Set(globalErrors.map(e => e.ruleId));
        console.assert(ruleIds.has('parse.empty_frontmatter'), 'FAIL: multiple malformed — parse.empty_frontmatter not in errors');
        console.assert(ruleIds.has('parse.missing_id'), 'FAIL: multiple malformed — parse.missing_id not in errors');
        console.log('PASS: multiple malformed files — promise resolves with all errors collected');
    } finally {
        await cleanup(dir);
    }
}

console.log('\nAll parse globals tests passed.');
