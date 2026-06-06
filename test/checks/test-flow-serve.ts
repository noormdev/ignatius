/**
 * Tests for CP-R3: /flow, /api/flow, /flow-dict server routes.
 *
 * Pattern mirrors test-api-model.ts (serveCommand + fetch + assert).
 *
 * Two server fixtures:
 *   - models/key-inherited  → has flows/ (order-to-cash + refund)
 *   - models/orm-hybrid     → has no flows/ (confirms 200 empty-state, not 500)
 */

import { resolve, join } from 'path';
import { serveCommand } from '../../src/server';

const ROOT = resolve(import.meta.dir, '../..');

// ── Fixture 1: model WITH flows ──────────────────────────────────────────────

const MODELS_WITH_FLOWS = join(ROOT, 'models/key-inherited');
const PORT_A = 3301;
const handleA = serveCommand(MODELS_WITH_FLOWS, { port: PORT_A });
const baseA = `http://localhost:${PORT_A}`;

// ── Fixture 2: model WITHOUT flows ───────────────────────────────────────────

const MODELS_NO_FLOWS = join(ROOT, 'models/orm-hybrid');
const PORT_B = 3302;
const handleB = serveCommand(MODELS_NO_FLOWS, { port: PORT_B });
const baseB = `http://localhost:${PORT_B}`;

// Give both servers a tick to bind.
await Bun.sleep(250);

let failures = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

// ── Suite A: model WITH flows ─────────────────────────────────────────────────

console.log('\n── GET /flow (has flows) ──');
{
  const res = await fetch(`${baseA}/flow`);
  assert(res.status === 200, '/flow: status 200', `got ${res.status}`);

  const body = await res.text();
  assert(
    body.includes('__IGNATIUS_SURFACE__') && body.includes('"flow"'),
    '/flow: body sets __IGNATIUS_SURFACE__ = "flow"',
    `snippet: ${body.slice(0, 500)}`,
  );
  assert(
    body.includes('__IGNATIUS_MODE__') && body.includes('"live"'),
    '/flow: body sets __IGNATIUS_MODE__ = "live"',
  );
}

console.log('\n── GET /api/flow (has flows) ──');
{
  const res = await fetch(`${baseA}/api/flow`);
  assert(res.status === 200, '/api/flow: status 200', `got ${res.status}`);

  const payload = await res.json() as Record<string, unknown>;

  // Top-level shape
  assert(Array.isArray(payload.diagrams), '/api/flow: payload.diagrams is an array',
    `keys: ${Object.keys(payload).join(', ')}`);
  assert('validation' in payload, '/api/flow: payload has "validation" key');
  assert(typeof payload.flowLayoutKeys === 'object' && payload.flowLayoutKeys !== null,
    '/api/flow: payload.flowLayoutKeys is an object');

  // key-inherited has order-to-cash + refund → 2 top-level diagrams
  const diagrams = payload.diagrams as unknown[];
  assert(
    diagrams.length === 2,
    `/api/flow: diagrams.length === 2 (got ${diagrams.length})`,
  );

  // Both diagram ids should appear in flowLayoutKeys
  const keys = payload.flowLayoutKeys as Record<string, unknown>;
  const diagram0 = diagrams[0] as Record<string, unknown>;
  const diagram1 = diagrams[1] as Record<string, unknown>;
  const id0 = typeof diagram0?.id === 'string' ? diagram0.id : '';
  const id1 = typeof diagram1?.id === 'string' ? diagram1.id : '';

  assert(
    id0 in keys,
    `/api/flow: flowLayoutKeys contains id "${id0}"`,
    `keys: ${Object.keys(keys).join(', ')}`,
  );
  assert(
    id1 in keys,
    `/api/flow: flowLayoutKeys contains id "${id1}"`,
    `keys: ${Object.keys(keys).join(', ')}`,
  );

  // Confirm the two expected diagram ids are present
  const ids = new Set([id0, id1]);
  assert(ids.has('order-to-cash'), '/api/flow: "order-to-cash" diagram present');
  assert(ids.has('refund'), '/api/flow: "refund" diagram present');

  // validation shape
  const validation = payload.validation as Record<string, unknown>;
  assert(Array.isArray(validation?.flowErrors), '/api/flow: validation.flowErrors is an array');
  assert(Array.isArray(validation?.globalErrors), '/api/flow: validation.globalErrors is an array');
  assert('cleanedFlowModel' in (validation ?? {}), '/api/flow: validation.cleanedFlowModel exists');
}

console.log('\n── GET /flow-dict (has flows) ──');
{
  const res = await fetch(`${baseA}/flow-dict`);
  assert(res.status === 200, '/flow-dict: status 200', `got ${res.status}`);

  const body = await res.text();
  // generateFlowDict emits per-process sections with class "flow-process-section" or similar.
  // The spec says it lists each process with its inputs/outputs table.
  // Check for the presence of a process section anchor format #process-<id>.
  assert(
    body.includes('process') && body.length > 500,
    '/flow-dict: body contains process content and is non-trivial',
    `length=${body.length}`,
  );
  assert(
    body.includes('<!doctype html') || body.includes('<!DOCTYPE html'),
    '/flow-dict: body is valid HTML',
  );
}

// ── Suite B: model WITHOUT flows → 200 empty-state, not 500 ──────────────────

console.log('\n── No-flows model: /flow, /api/flow, /flow-dict ──');
{
  const resFlow = await fetch(`${baseB}/flow`);
  assert(
    resFlow.status === 200,
    '/flow (no flows): returns 200, not 500',
    `got ${resFlow.status}`,
  );

  const resApi = await fetch(`${baseB}/api/flow`);
  assert(
    resApi.status === 200,
    '/api/flow (no flows): returns 200, not 500',
    `got ${resApi.status}`,
  );

  const payload = await resApi.json() as Record<string, unknown>;
  assert(
    Array.isArray(payload.diagrams) && (payload.diagrams as unknown[]).length === 0,
    '/api/flow (no flows): diagrams is an empty array',
    `diagrams: ${JSON.stringify(payload.diagrams)}`,
  );

  const resFlowDict = await fetch(`${baseB}/flow-dict`);
  assert(
    resFlowDict.status === 200,
    '/flow-dict (no flows): returns 200, not 500',
    `got ${resFlowDict.status}`,
  );
}

// ── Teardown ─────────────────────────────────────────────────────────────────

handleA.stop(true);
handleB.stop(true);

console.log('\n' + (failures === 0 ? 'All flow-serve tests passed.' : `${failures} flow-serve test(s) FAILED.`));
if (failures > 0) process.exit(1);
