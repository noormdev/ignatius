/**
 * Tests for /api/model response shape (CP-4).
 *
 * Verifies the new payload: { model, parseGlobalErrors, validation }
 * where validation = { entityErrors, globalErrors, cleanedModel }.
 *
 * Pattern adapted from test-asset-route.ts.
 */

import { resolve, join } from 'path';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/key-inherited');

const handle = serveCommand(MODELS, { port: 3178 });
const base = `http://localhost:3178`;

// Give the server a tick to bind
await Bun.sleep(200);

let failures = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: /api/model returns the new payload shape
// ---------------------------------------------------------------------------

{
  const res = await fetch(`${base}/api/model`);
  assert(res.status === 200, '/api/model: status 200');

  const payload = await res.json() as Record<string, unknown>;

  // Top-level keys
  assert('model' in payload, '/api/model: payload has "model" key',
    `keys: ${Object.keys(payload).join(', ')}`);
  assert('parseGlobalErrors' in payload, '/api/model: payload has "parseGlobalErrors" key',
    `keys: ${Object.keys(payload).join(', ')}`);
  assert('validation' in payload, '/api/model: payload has "validation" key',
    `keys: ${Object.keys(payload).join(', ')}`);

  // model sub-shape
  const model = payload.model as Record<string, unknown>;
  assert(Array.isArray(model?.nodes), '/api/model: model.nodes is an array');
  assert(Array.isArray(model?.edges), '/api/model: model.edges is an array');

  // parseGlobalErrors is an array
  assert(Array.isArray(payload.parseGlobalErrors), '/api/model: parseGlobalErrors is an array');

  // validation sub-shape
  const validation = payload.validation as Record<string, unknown>;
  assert(Array.isArray(validation?.entityErrors), '/api/model: validation.entityErrors is an array');
  assert(Array.isArray(validation?.globalErrors), '/api/model: validation.globalErrors is an array');
  assert('cleanedModel' in (validation ?? {}), '/api/model: validation.cleanedModel exists');

  // Real models/ baseline: 24 nodes
  assert(
    (model?.nodes as unknown[])?.length === 24,
    `/api/model: model.nodes has 24 entries (got ${(model?.nodes as unknown[])?.length})`,
  );

  // Real models/ baseline: 1 entityError (entity warnings, naming rules removed in Phase 3 polish)
  const entityErrors = validation?.entityErrors as unknown[];
  assert(
    entityErrors?.length === 1,
    `/api/model: validation.entityErrors has 1 entries (got ${entityErrors?.length})`,
  );
}

handle.stop(true);

console.log('\n' + (failures === 0 ? 'All api-model tests passed.' : `${failures} api-model test(s) FAILED.`));
if (failures > 0) process.exit(1);
