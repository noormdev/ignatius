/**
 * CI check: synthetic model generator produces a valid model.
 *
 * Generates a small synthetic model (n=30 for speed), then validates it
 * clean with parseModels + validateModel. This proves the generator writes
 * well-formed entity files that satisfy every lint rule.
 *
 * Perf note: n=300 takes ~30s with ELK in a browser; n=30 runs server-side
 * in <2s and is appropriate for a CI check.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '../..');

function pass(msg: string) { console.log(`  PASS  ${msg}`); }
function fail(msg: string): never { console.error(`  FAIL  ${msg}`); process.exit(1); }

// ── Generate a small synthetic model ─────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'ignatius-synthetic-'));
const modelDir = join(tmpDir, 'model');

const genResult = Bun.spawnSync(
  ['bun', 'scripts/gen-synthetic-model.ts', '--n', '30', '--out', modelDir],
  { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
);

if (genResult.exitCode !== 0) {
  const stderr = genResult.stderr ? new TextDecoder().decode(genResult.stderr) : '';
  fail(`Generator exited ${genResult.exitCode}: ${stderr}`);
}
pass('generator exited 0');

// ── Parse ─────────────────────────────────────────────────────────────────────

const { parseModels } = await import('../../src/model/parse');
const { validateModel } = await import('../../src/model/validate');

const { model, globalErrors } = await parseModels(modelDir);
pass(`parseModels: ${model.nodes.length} nodes, ${model.edges.length} edges`);

if (model.nodes.length < 10) {
  fail(`Expected at least 10 nodes for n=30, got ${model.nodes.length}`);
}
pass(`node count ≥ 10 (got ${model.nodes.length})`);

if (model.edges.length < 5) {
  fail(`Expected at least 5 edges for n=30, got ${model.edges.length}`);
}
pass(`edge count ≥ 5 (got ${model.edges.length})`);

// ── Global parse errors ───────────────────────────────────────────────────────

if (globalErrors.length > 0) {
  const msgs = globalErrors.map(e => `${e.ruleId}: ${e.reason}`).join(', ');
  fail(`parseModels produced global errors: ${msgs}`);
}
pass('parseModels: no global errors');

// ── Validate ──────────────────────────────────────────────────────────────────

const { entityErrors, globalErrors: valGlobal } = validateModel(model);

if (valGlobal.length > 0) {
  const msgs = valGlobal.map(e => `${e.ruleId}: ${e.reason}`).join(', ');
  fail(`validateModel global errors: ${msgs}`);
}
pass('validateModel: no global errors');

if (entityErrors.length > 0) {
  const msgs = entityErrors.map(e => `${e.entityId}/${e.ruleId}`).join(', ');
  fail(`validateModel entity errors: ${msgs}`);
}
pass('validateModel: no entity errors');

// ── Subtype cluster ───────────────────────────────────────────────────────────

if (model.subtypeClusters.length < 2) {
  fail(`Expected ≥2 subtype clusters, got ${model.subtypeClusters.length}`);
}
pass(`subtypeClusters ≥ 2 (got ${model.subtypeClusters.length})`);

// ── Cleanup ───────────────────────────────────────────────────────────────────

rmSync(tmpDir, { recursive: true, force: true });

console.log('\nAll synthetic-model tests passed.');
