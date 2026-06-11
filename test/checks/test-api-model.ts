/**
 * Tests for /api/model response shape (CP-4).
 *
 * Verifies the new payload: { model, parseGlobalErrors, validation }
 * where validation = { entityErrors, globalErrors, cleanedModel }.
 *
 * Pattern adapted from test-asset-route.ts.
 */

import { resolve, join } from 'path';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models/broken-demo');

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

  // broken-demo baseline: parses 9 entities (3 files skipped: bad-yaml, empty-frontmatter, no-entity-id)
  assert(
    (model?.nodes as unknown[])?.length === 9,
    `/api/model: model.nodes has 9 entries (got ${(model?.nodes as unknown[])?.length})`,
  );

  // broken-demo baseline: 9 entity warnings (7 + 1 live-only example_unknown_column
  // on Customer + 1 body.unknown_link from Order's [[Cart]] body link)
  const entityErrors = validation?.entityErrors as unknown[];
  assert(
    entityErrors?.length === 9,
    `/api/model: validation.entityErrors has 9 entries (got ${entityErrors?.length})`,
  );

  // broken-demo baseline: 1 validator global (edge.unknown_target Order→Cart) +
  // 3 parse globals = 4 total in payload (parseGlobalErrors separate from validation.globalErrors)
  const validatorGlobals = validation?.globalErrors as unknown[];
  assert(
    validatorGlobals?.length === 1,
    `/api/model: validation.globalErrors has 1 entry (got ${validatorGlobals?.length})`,
  );

  // layoutKey must be a non-empty string
  assert(
    typeof payload.layoutKey === 'string' && payload.layoutKey.length > 0,
    `/api/model: payload has a non-empty "layoutKey" string (got ${JSON.stringify(payload.layoutKey)})`,
  );
}

handle.stop(true);

console.log('\n' + (failures === 0 ? 'All api-model tests passed.' : `${failures} api-model test(s) FAILED.`));
if (failures > 0) process.exit(1);
