/**
 * test-flow-diagram-description.ts — a DFD folder describes itself through
 * `description:` in its index file's frontmatter.
 *
 * Why it matters: the flow index and the breadcrumb level menus list every
 * diagram with a description, and a top-level DFD folder had no file of its
 * own to carry one. The index file is also the generated router, so the
 * description must survive `ignatius index` regeneration, feed the parent
 * router's folder row, and leave every existing digest alone when absent.
 *
 * Generates its fixture at runtime under tmp/.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { assert } from '../assert';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';
import { buildRouters } from '../../src/router/build';
import { writeRouters } from '../../src/router/write';
import { SYSTEM_PROCESS_ID } from '../../src/flows/flow-derive-levels';

const FIXTURE = 'tmp/flow-diagram-description-fixture';

function findDiagram(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagram(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const PROCESS = (name: string, extra = '') => `---
process: ${name}
description: ${name} does its one job.
inputs:
  - from: ext:Clerk
    data: request
outputs:
  - to: ext:Clerk
    data: response
${extra}---
`;

rmSync(FIXTURE, { recursive: true, force: true });
mkdirSync(`${FIXTURE}/flows/billing/Submit`, { recursive: true });
mkdirSync(`${FIXTURE}/flows/ops`, { recursive: true });
mkdirSync(`${FIXTURE}/externals`, { recursive: true });
writeFileSync(`${FIXTURE}/ignatius.yml`, 'name: Fixture\n');
writeFileSync(`${FIXTURE}/externals/Clerk.md`, '---\nexternal: Clerk\n---\n');
writeFileSync(`${FIXTURE}/flows/billing/index.md`, `---
description: Billing scopes and sending invoices.
---
`);
writeFileSync(`${FIXTURE}/flows/billing/Submit.md`, PROCESS('Submit'));
writeFileSync(`${FIXTURE}/flows/billing/Submit/Check.md`, PROCESS('Check'));
writeFileSync(`${FIXTURE}/flows/ops/Run.md`, PROCESS('Run'));

// Absent description is not an error; a described folder reaches the diagram.
{
  const { flowModel, globalErrors } = await parseFlows(FIXTURE);
  assert(globalErrors.length === 0, `FAIL: expected no parse errors, got ${JSON.stringify(globalErrors)}`);

  const billing = findDiagram(flowModel.diagrams, 'billing');
  assert(billing?.description === 'Billing scopes and sending invoices.', `FAIL: billing.description = ${JSON.stringify(billing?.description)}`);
  console.log('PASS: index.md description reaches FlowDiagram.description');

  const ops = findDiagram(flowModel.diagrams, 'ops');
  assert(ops !== undefined && ops.description === undefined, `FAIL: ops.description should be absent, got ${JSON.stringify(ops?.description)}`);
  console.log('PASS: a folder without an index file has no description and no error');

  const submitSub = findDiagram(flowModel.diagrams, 'Submit');
  assert(submitSub !== undefined && submitSub.description === undefined, 'FAIL: a sub-DFD with no index file must not copy its process description into the diagram');
  console.log('PASS: sub-DFD description stays absent (process description is a display fallback only)');

  const system = findDiagram(flowModel.diagrams, SYSTEM_PROCESS_ID);
  const l1Billing = system?.processes.find(p => p.id === 'billing');
  assert(l1Billing?.description === 'Billing scopes and sending invoices.', `FAIL: L1 process for billing carries ${JSON.stringify(l1Billing?.description)}`);
  const l1Ops = system?.processes.find(p => p.id === 'ops');
  assert(l1Ops !== undefined && l1Ops.description === undefined, 'FAIL: L1 process for ops should have no description');
  console.log('PASS: the L1 overview process of a described flow carries its description');
}

// Router: the folder row shows the description, regeneration keeps the
// frontmatter, and an undescribed folder's row hash is its plain digest.
{
  const { model } = await parseModels(FIXTURE);
  const { flowModel } = await parseFlows(FIXTURE);
  const routers = await buildRouters(FIXTURE, model, flowModel);
  const flowsRouter = routers.find(r => r.relPath === 'flows/index.md');
  assert(flowsRouter !== undefined, 'FAIL: flows/index.md router not built');
  assert(
    flowsRouter!.table.includes('| billing | folder | Billing scopes and sending invoices. |'),
    `FAIL: flows router billing row lacks the description:\n${flowsRouter!.table}`,
  );
  const opsRouter = routers.find(r => r.relPath === 'flows/ops/index.md');
  const billingRouter = routers.find(r => r.relPath === 'flows/billing/index.md');
  assert(opsRouter !== undefined && billingRouter !== undefined, 'FAIL: per-flow routers not built');
  console.log('PASS: parent router folder row renders the flow description');

  await writeRouters(FIXTURE, routers);
  const written = readFileSync(`${FIXTURE}/flows/billing/index.md`, 'utf8');
  assert(written.startsWith('---\ndescription: Billing scopes and sending invoices.\n---\n'), `FAIL: frontmatter did not survive router write:\n${written}`);
  assert(written.includes('<ignatius-index scope="flow-diagram"'), 'FAIL: router region missing after write');

  const reparsed = await parseFlows(FIXTURE);
  assert(reparsed.globalErrors.length === 0, `FAIL: re-parse after router write errored: ${JSON.stringify(reparsed.globalErrors)}`);
  assert(findDiagram(reparsed.flowModel.diagrams, 'billing')?.description === 'Billing scopes and sending invoices.', 'FAIL: description lost after router write');
  assert(findDiagram(reparsed.flowModel.diagrams, 'ops')?.description === undefined, 'FAIL: a router-only index file (no frontmatter) must yield no description');
  console.log('PASS: router regeneration keeps the frontmatter; a router-only index yields no description');

  const opsDigest = opsRouter!.attrs.digest;
  const billingDigest = billingRouter!.attrs.digest;
  assert(flowsRouter!.table.includes('| ops | folder |  |'), 'FAIL: ops row should have an empty description');

  // Changing only the description must change the parent digest.
  writeFileSync(`${FIXTURE}/flows/billing/index.md`, written.replace('Billing scopes and sending invoices.', 'Billing, reworded.'));
  const { flowModel: reworded } = await parseFlows(FIXTURE);
  const rerouted = await buildRouters(FIXTURE, model, reworded);
  const rewordedFlows = rerouted.find(r => r.relPath === 'flows/index.md');
  assert(rewordedFlows!.attrs.digest !== flowsRouter!.attrs.digest, 'FAIL: rewording a flow description left the flows/ digest unchanged');
  assert(rerouted.find(r => r.relPath === 'flows/billing/index.md')!.attrs.digest === billingDigest, 'FAIL: the described folder\'s own digest should not change');
  assert(rerouted.find(r => r.relPath === 'flows/ops/index.md')!.attrs.digest === opsDigest, 'FAIL: a sibling digest changed');
  console.log('PASS: a description edit dirties the parent digest only');
}

// Malformed frontmatter is reported, not swallowed.
{
  writeFileSync(`${FIXTURE}/flows/ops/index.md`, '---\ndescription: [unclosed\n---\n');
  const { globalErrors } = await parseFlows(FIXTURE);
  assert(
    globalErrors.some(e => e.ruleId === 'parse.invalid_yaml' && e.reason.includes('flows/ops/index.md')),
    `FAIL: malformed index frontmatter should report parse.invalid_yaml, got ${JSON.stringify(globalErrors)}`,
  );
  console.log('PASS: malformed index frontmatter reports parse.invalid_yaml');
}

rmSync(FIXTURE, { recursive: true, force: true });
console.log('\nAll flow-diagram-description tests passed.');
