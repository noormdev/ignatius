/**
 * test-leveling.ts — CP4 level derivation assertions (C6, C7, C12).
 *
 * Proves on models/llm-memory-db-mssql that deriveLevels() produces:
 *   C6  — context diagram has exactly 1 process, and every edge connects
 *          that process to an external (no store edges).
 *   C7  — L1 overview contains all 6 activity processes; contains every
 *          store with leaf-degree ≥ 2; contains NO store with leaf-degree = 1.
 *   C12 — L1 processes are numbered 1…6; each leaf diagram's processes
 *          carry dotted numbers N.x under their L1 parent.
 *
 * TDD order: write failing test, confirm failure, implement, confirm green.
 */

import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram, FlowModel } from '../../src/flows/flow-parse';

const MODEL_DIR = './models/llm-memory-db-mssql';

function fail(msg: string): never {
    console.error('FAIL:', msg);
    process.exit(1);
}

function pass(msg: string) {
    console.log('PASS:', msg);
}

// ---------------------------------------------------------------------------
// Parse and verify the leveled model
// ---------------------------------------------------------------------------

const { flowModel, globalErrors } = await parseFlows(MODEL_DIR);

if (globalErrors.length > 0) {
    fail(`Parse errors on proving model: ${JSON.stringify(globalErrors)}`);
}

const { diagrams } = flowModel;

// After CP4 wiring, diagrams[0] = context, diagrams[1] = L1 overview,
// diagrams[2..] = the original 6 leaf diagrams (or leaves as subDfds).
// The leveled tree structure must have context at the root of diagrams array.

if (diagrams.length === 0) {
    fail('No diagrams found in proving model');
}

// ---------------------------------------------------------------------------
// C6 — Context diagram: exactly 1 process, only external edges
// ---------------------------------------------------------------------------

const contextDiagram = diagrams[0];
if (!contextDiagram) fail('diagrams[0] (context) is undefined');

// Must have exactly 1 process (the system bubble)
if (contextDiagram.processes.length !== 1) {
    fail(
        `C6: context diagram must have exactly 1 process, got ${contextDiagram.processes.length}: ` +
        contextDiagram.processes.map(p => p.id).join(', '),
    );
}
pass(`C6: context diagram has exactly 1 process (${contextDiagram.processes[0]!.id})`);

// All edges must connect the system process to an external — no store edges
const systemProcId = contextDiagram.processes[0]!.id;
const badContextEdges = contextDiagram.edges.filter(e => {
    // At least one endpoint must be ext; neither should be db/cache/etc.
    const fromIsStore = e.from.kind !== 'proc' && e.from.kind !== 'ext';
    const toIsStore = e.to.kind !== 'proc' && e.to.kind !== 'ext';
    return fromIsStore || toIsStore;
});

if (badContextEdges.length > 0) {
    fail(
        `C6: context diagram has ${badContextEdges.length} store edge(s) — only ext flows allowed: ` +
        badContextEdges.map(e => `${e.from.raw}→${e.to.raw}`).join(', '),
    );
}
pass('C6: context diagram edges are all external boundary flows (no store edges)');

// ---------------------------------------------------------------------------
// C7 — L1 overview: 6 activity processes; degree≥2 stores present; degree-1 absent
// ---------------------------------------------------------------------------

// The context diagram must have a subDfd pointing to L1
if (contextDiagram.subDfds.length === 0) {
    fail('C7: context diagram has no subDfds (expected L1 overview as subDfd)');
}

const l1Diagram = contextDiagram.subDfds.find(d => d.id === systemProcId);
if (!l1Diagram) {
    fail(
        `C7: L1 overview subDfd not found — expected id="${systemProcId}", ` +
        `context subDfds: [${contextDiagram.subDfds.map(d => d.id).join(', ')}]`,
    );
}

// The proving model has 6 activity diagrams
const EXPECTED_ACTIVITY_COUNT = 6;
if (l1Diagram.processes.length !== EXPECTED_ACTIVITY_COUNT) {
    fail(
        `C7: L1 overview must have ${EXPECTED_ACTIVITY_COUNT} activity processes, ` +
        `got ${l1Diagram.processes.length}: ${l1Diagram.processes.map(p => p.id).join(', ')}`,
    );
}
pass(`C7: L1 overview has all ${EXPECTED_ACTIVITY_COUNT} activity processes`);

// Known degree≥2 stores on the proving model:
//   db:StateTransition      (degree 4 — artifact, memory, note, work-planning)
//   db:RelevanceStatus_Allowed (degree 3 — artifact, memory, note)
//   db:Memory               (degree 2 — agent-project-setup, memory-lifecycle)
//   db:Memory_Tag           (degree 2 — memory-lifecycle, tag-administration)
//   db:Milestone            (degree 2 — agent-project-setup, work-planning)
const DEGREE_GTE2_STORES = new Set([
    'db:StateTransition',
    'db:RelevanceStatus_Allowed',
    'db:Memory',
    'db:Memory_Tag',
    'db:Milestone',
]);

// Known degree-1 stores (should NOT appear at L1)
const DEGREE_1_STORES = new Set([
    'db:Agent',
    'db:Artifact',
    'db:Artifact_StateTransition',
    'db:Artifact_Tag',
    'db:DependencyVerb',
    'db:MemoryCategory',
    'db:MemoryDomain',
    'db:MemoryRelationVerb',
    'db:Memory_StateTransition',
    'db:Milestone_Artifact',
    'db:Milestone_Note',
    'db:Milestone_StateTransition',
    'db:Milestone_Tag',
    'db:Note',
    'db:Note_StateTransition',
    'db:Project',
    'db:Project_Memory',
    'db:Project_Note',
    'db:Project_Tag',
    'db:Related_Memory',
    'db:Tag',
    'db:Task',
    'db:Task_Artifact',
    'db:Task_Dependency',
    'db:Task_Note',
    'db:Task_StateTransition',
    'db:Task_Tag',
    'db:TrackingStatus_Allowed',
]);

const l1StoreTokens = new Set(l1Diagram.storeRefs.map(s => `${s.kind}:${s.name}`));

// Every degree≥2 store must appear at L1
for (const token of DEGREE_GTE2_STORES) {
    if (!l1StoreTokens.has(token)) {
        fail(`C7: degree≥2 store '${token}' is absent from L1 — must be promoted`);
    }
}
pass(`C7: all ${DEGREE_GTE2_STORES.size} degree≥2 stores are present at L1`);

// No degree-1 store may appear at L1
for (const token of DEGREE_1_STORES) {
    if (l1StoreTokens.has(token)) {
        fail(`C7: degree-1 store '${token}' appears at L1 — must be subsumed (omitted)`);
    }
}
pass(`C7: no degree-1 stores are present at L1`);

// ---------------------------------------------------------------------------
// C12 — Dotted-number correctness
// ---------------------------------------------------------------------------

// L1 processes must be numbered 1, 2, …, 6 (stable sorted order)
const l1Procs = [...l1Diagram.processes].sort((a, b) => {
    const na = parseInt(a.dottedNumber, 10);
    const nb = parseInt(b.dottedNumber, 10);
    return na - nb;
});

for (let i = 0; i < l1Procs.length; i++) {
    const proc = l1Procs[i]!;
    const expectedDotted = String(i + 1);
    if (proc.dottedNumber !== expectedDotted) {
        fail(
            `C12: L1 process '${proc.id}' has dottedNumber '${proc.dottedNumber}', ` +
            `expected '${expectedDotted}'`,
        );
    }
}
pass('C12: L1 processes are numbered 1…6 (stable order, dottedNumber correct)');

// Each L1 process must have a subDfd (its leaf diagram), and that leaf diagram's
// processes must carry dotted numbers N.x under their parent L1 number N.
for (const l1Proc of l1Diagram.processes) {
    const parentN = parseInt(l1Proc.dottedNumber, 10);
    const leafSubDfd = l1Diagram.subDfds.find(d => d.id === l1Proc.id);
    if (!leafSubDfd) {
        fail(`C12: L1 process '${l1Proc.id}' (N=${parentN}) has no subDfd`);
    }
    // All processes in the leaf must have dottedNumber starting with N.
    for (const leafProc of leafSubDfd.processes) {
        if (!leafProc.dottedNumber.startsWith(`${parentN}.`)) {
            fail(
                `C12: leaf process '${leafProc.id}' in '${leafSubDfd.id}' has ` +
                `dottedNumber '${leafProc.dottedNumber}', expected '${parentN}.<x>'`,
            );
        }
    }
}
pass('C12: leaf diagram processes carry dotted numbers N.x under their L1 parent');

console.log('\nAll test-leveling checks PASSED (C6, C7, C12).');
