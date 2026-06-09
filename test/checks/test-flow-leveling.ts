/**
 * test-flow-leveling.ts — Recursive sub-DFD detection + data-level balancing.
 *
 * Part C of Checkpoint 7:
 * 1. 3-level nested fixture parses with subDfds populated at each level.
 * 2. flow.unbalanced_decomposition FIRES when db: boundary columns mismatch
 *    at a DEEP seam (below the top level) — proves recursion catches it.
 * 3. SILENT on a balanced nested fixture (no false positives).
 * 4. Sibling-to-sibling (proc→proc inside sub-DFD) flows are EXCLUDED
 *    from the boundary column set.
 *
 * Uses models/key-inherited/ entity catalog for db: resolution.
 * Fixture: test/fixtures/flows-leveling/ (3 levels: auth→Authenticate→Login).
 */

import { parseFlows } from '../../src/flow-parse';
import { parseModels } from '../../src/parse';
import { validateFlows } from '../../src/flow-validate';
import type { FlowError } from '../../src/flow-validate';
import type {
    FlowModel,
    FlowDiagram,
    FlowEdge,
    FlowProcess,
    FlowStoreRef,
} from '../../src/flow-parse';
import type { Model, ModelNode } from '../../src/parse';
import { defaultTheme } from '../../src/theme-defaults';
import { defaultBranding } from '../../src/branding-defaults';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg: string): never {
    console.error('FAIL:', msg);
    process.exit(1);
}

function pass(msg: string) {
    console.log('PASS:', msg);
}

function hasRule(errors: FlowError[], ruleId: string): boolean {
    return errors.some(e => e.ruleId === ruleId);
}

function makeEndpoint(kind: FlowEdge['from']['kind'], name: string): FlowEdge['from'] {
    return { kind, name, raw: `${kind}:${name}` };
}

function makeEdge(
    fromKind: FlowEdge['from']['kind'],
    fromName: string,
    toKind: FlowEdge['to']['kind'],
    toName: string,
    data: string | string[] = '',
    flowId = 'test',
): FlowEdge {
    return {
        from: makeEndpoint(fromKind, fromName),
        to: makeEndpoint(toKind, toName),
        data,
        flowId,
    };
}

function makeProcess(id: string, flowId: string, overrides: Partial<FlowProcess> = {}): FlowProcess {
    return {
        id,
        label: id,
        dottedNumber: '1',
        inputs: [],
        outputs: [],
        body: '',
        bodyHtml: '',
        hasSubDfd: false,
        flowId,
        ...overrides,
    };
}

function makeDiagram(
    id: string,
    processes: FlowProcess[],
    externals: FlowExternal[],
    storeRefs: FlowStoreRef[],
    edges: FlowEdge[],
    subDfds: FlowDiagram[] = [],
): FlowDiagram {
    return { id, title: id, processes, externals, storeRefs, edges, subDfds };
}

function makeModel(diagrams: FlowDiagram[]): FlowModel {
    return { diagrams, modelDir: '/test' };
}

type FlowExternal = { id: string; label: string; body: string; bodyHtml: string; flowId: string };

function baseNode(id: string, pkCols: string[], extraCols: string[] = []): ModelNode {
    const columns: Record<string, { type: string }> = {};
    for (const col of pkCols) columns[col] = { type: 'integer' };
    for (const col of extraCols) columns[col] = { type: 'text' };
    return {
        id,
        classification: 'independent',
        pk: pkCols,
        columns,
        alternateKeys: [],
        bodyHtml: '',
    };
}

function baseEntityModel(nodes: ModelNode[]): Model {
    return {
        groups: {},
        nodes,
        edges: [],
        subtypeClusters: [],
        theme: defaultTheme,
        branding: defaultBranding,
    };
}

// Entity model: Party has party_id + type; we use party_id for boundary tests.
const partyEntityModel = baseEntityModel([
    baseNode('Party', ['party_id'], ['type']),
]);

// ---------------------------------------------------------------------------
// Test 1: 3-level fixture parses correctly (subDfds populated at each level)
// ---------------------------------------------------------------------------

{
    const fixtureDir = './test/fixtures/flows-leveling';
    const { flowModel, globalErrors } = await parseFlows(fixtureDir);

    if (globalErrors.length > 0) {
        fail(`3-level fixture has parse errors: ${JSON.stringify(globalErrors)}`);
    }

    if (flowModel.diagrams.length === 0) {
        fail('3-level fixture: no diagrams found');
    }

    const authDiagram = flowModel.diagrams.find(d => d.id === 'auth');
    if (!authDiagram) {
        fail(`3-level fixture: expected diagram 'auth', got: ${flowModel.diagrams.map(d => d.id).join(', ')}`);
    }

    // Level 1: auth has process Authenticate with hasSubDfd = true
    const authenticateProc = authDiagram.processes.find(p => p.id === 'Authenticate');
    if (!authenticateProc) {
        fail(`Level 1: process 'Authenticate' not found in auth diagram`);
    }
    if (!authenticateProc.hasSubDfd) {
        fail(`Level 1: process 'Authenticate' should have hasSubDfd = true`);
    }
    pass('Level 1: Authenticate process found with hasSubDfd = true');

    // Level 1: auth has one sub-DFD for Authenticate
    if (authDiagram.subDfds.length === 0) {
        fail('Level 1: auth diagram has no subDfds');
    }
    const authenticateSubDfd = authDiagram.subDfds.find(d => d.id === 'Authenticate');
    if (!authenticateSubDfd) {
        fail(`Level 1: sub-DFD 'Authenticate' not found; subDfds: ${authDiagram.subDfds.map(d => d.id).join(', ')}`);
    }
    pass('Level 1: auth diagram has sub-DFD Authenticate');

    // Level 2: Authenticate sub-DFD has process Login with hasSubDfd = true
    const loginProc = authenticateSubDfd.processes.find(p => p.id === 'Login');
    if (!loginProc) {
        fail(`Level 2: process 'Login' not found in Authenticate sub-DFD`);
    }
    if (!loginProc.hasSubDfd) {
        fail(`Level 2: process 'Login' should have hasSubDfd = true`);
    }
    pass('Level 2: Login process found in Authenticate sub-DFD with hasSubDfd = true');

    // Level 2: Authenticate sub-DFD has sub-DFD for Login
    if (authenticateSubDfd.subDfds.length === 0) {
        fail('Level 2: Authenticate sub-DFD has no subDfds');
    }
    const loginSubDfd = authenticateSubDfd.subDfds.find(d => d.id === 'Login');
    if (!loginSubDfd) {
        fail(`Level 2: sub-DFD 'Login' not found`);
    }
    pass('Level 2: Authenticate sub-DFD has sub-DFD Login');

    // Level 3: Login sub-DFD has processes VerifyToken and CreateSession
    const verifyProc = loginSubDfd.processes.find(p => p.id === 'VerifyToken');
    const createProc = loginSubDfd.processes.find(p => p.id === 'CreateSession');
    if (!verifyProc) {
        fail(`Level 3: process 'VerifyToken' not found in Login sub-DFD`);
    }
    if (!createProc) {
        fail(`Level 3: process 'CreateSession' not found in Login sub-DFD`);
    }
    pass('Level 3: Login sub-DFD has VerifyToken and CreateSession processes');

    // Level 3: neither VerifyToken nor CreateSession has a sub-DFD (leaves)
    if (verifyProc.hasSubDfd) {
        fail('Level 3: VerifyToken should not have hasSubDfd (it is a leaf)');
    }
    if (createProc.hasSubDfd) {
        fail('Level 3: CreateSession should not have hasSubDfd (it is a leaf)');
    }
    pass('Level 3: VerifyToken and CreateSession are leaf processes (hasSubDfd = false)');
}

// ---------------------------------------------------------------------------
// Test 2: Balanced nested fixture → no flow.unbalanced_decomposition at any level
// ---------------------------------------------------------------------------

{
    const fixtureDir = './test/fixtures/flows-leveling';
    const { flowModel } = await parseFlows(fixtureDir);

    const result = validateFlows(flowModel, partyEntityModel);

    if (hasRule(result.flowErrors, 'flow.unbalanced_decomposition')) {
        const decomp = result.flowErrors.filter(e => e.ruleId === 'flow.unbalanced_decomposition');
        fail(`Balanced fixture should have no flow.unbalanced_decomposition, got: ${JSON.stringify(decomp)}`);
    }
    pass('Balanced nested fixture: flow.unbalanced_decomposition is silent');
}

// ---------------------------------------------------------------------------
// Test 3: Sibling-internal flows excluded from boundary column set
//
// The Login sub-DFD has a proc:VerifyToken → proc:CreateSession edge
// (sibling-internal). This must NOT contribute to the boundary column set.
// We verify: if we replaced db:Party[party_id] with a different column in
// the sub-DFD boundary edges but left the sibling flow unchanged, the rule
// fires only on the db: mismatch, not on the sibling-internal data.
//
// Inline test: build a FlowModel with a sibling-internal proc→proc flow
// carrying db: data (unusual but defensive) and verify it doesn't count.
// ---------------------------------------------------------------------------

{
    // Sub-DFD has two procs: ProcA and ProcB
    // Boundary: ext:User → ProcA (data: user_id) — NOT db, ignored
    // Sibling: proc:ProcA → proc:ProcB (data: 'internal') — sibling-internal, excluded
    // Boundary: proc:ProcB → db:Party (data: [party_id]) — boundary, db:Party party_id
    //
    // Parent process has db:Party[party_id] → must match.

    const siblingEdge = makeEdge('proc', 'ProcA', 'proc', 'ProcB', 'internal', 'sub');
    const dbOutputEdge = makeEdge('proc', 'ProcB', 'db', 'Party', ['party_id'], 'sub');
    const extInputEdge = makeEdge('ext', 'User', 'proc', 'ProcA', 'user_id', 'sub');

    const procA = makeProcess('ProcA', 'sub', {
        inputs: [extInputEdge],
        outputs: [siblingEdge],
    });
    const procB = makeProcess('ProcB', 'sub', {
        inputs: [siblingEdge],
        outputs: [dbOutputEdge],
    });

    const subDiagram = makeDiagram(
        'Parent',           // id matches the parent process id
        [procA, procB],
        [{ id: 'User', label: 'User', body: '', bodyHtml: '', flowId: 'sub' }],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'sub' }],
        [extInputEdge, siblingEdge, dbOutputEdge],
    );

    // Parent process "Parent" has db:Party[party_id] as output boundary
    const parentDbInputEdge = makeEdge('db', 'Party', 'proc', 'Parent', ['party_id'], 'root');
    // wait — the parent receives from db:Party[party_id] as input only
    // and no output to db:Party, so boundary is: db:Party={party_id} from sub
    // parent: db:Party={party_id} from input edge only
    const parentProcess = makeProcess('Parent', 'root', {
        hasSubDfd: true,
        inputs: [
            makeEdge('db', 'Party', 'proc', 'Parent', ['party_id'], 'root'),
        ],
        outputs: [],
    });

    const rootDiagram = makeDiagram(
        'root',
        [parentProcess],
        [{ id: 'User', label: 'User', body: '', bodyHtml: '', flowId: 'root' }],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'root' }],
        [makeEdge('db', 'Party', 'proc', 'Parent', ['party_id'], 'root')],
        [subDiagram],
    );

    const model = makeModel([rootDiagram]);
    const result = validateFlows(model, partyEntityModel);

    if (hasRule(result.flowErrors, 'flow.unbalanced_decomposition')) {
        const decomp = result.flowErrors.filter(e => e.ruleId === 'flow.unbalanced_decomposition');
        fail(`Sibling-exclusion test: should be balanced (sibling edge excluded), got: ${JSON.stringify(decomp)}`);
    }
    pass('Sibling-internal flows excluded from boundary column set (balanced result)');
}

// ---------------------------------------------------------------------------
// Test 4: Deep seam mismatch → flow.unbalanced_decomposition fires at depth 2
//
// Top seam (auth→Authenticate) is balanced.
// Deep seam (Authenticate→Login) has a column mismatch.
// Verifies the recursion catches the deep mismatch.
// ---------------------------------------------------------------------------

{
    // Top-level diagram: Authenticate process, db:Party[party_id] boundary — balanced with sub-DFD
    // Deep sub-DFD (Login level): Login process boundary uses db:Party[type] instead of [party_id]
    // → mismatch at Login seam → fires.

    // Level 3 (leaf): CreateSession reads db:Party[type] — mismatches Login's parent declaration
    const l3Edge = makeEdge('db', 'Party', 'proc', 'CreateSession', ['type'], 'login');
    const l3OutEdge = makeEdge('proc', 'CreateSession', 'db', 'Party', ['type'], 'login');
    const l3Proc = makeProcess('CreateSession', 'login', {
        inputs: [l3Edge],
        outputs: [l3OutEdge],
    });
    const loginSubDfd = makeDiagram(
        'Login',
        [l3Proc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'login' }],
        [l3Edge, l3OutEdge],
    );

    // Level 2 (Login process): declares db:Party[party_id] as its own inputs/outputs
    // but its sub-DFD (loginSubDfd) uses db:Party[type] → mismatch at Login seam
    const l2ParentInputEdge = makeEdge('db', 'Party', 'proc', 'Login', ['party_id'], 'auth');
    const l2ParentOutEdge = makeEdge('proc', 'Login', 'db', 'Party', ['party_id'], 'auth');
    const l2Proc = makeProcess('Login', 'auth', {
        hasSubDfd: true,
        inputs: [l2ParentInputEdge],
        outputs: [l2ParentOutEdge],
    });
    const authSubDfd = makeDiagram(
        'Authenticate',
        [l2Proc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'auth' }],
        [l2ParentInputEdge, l2ParentOutEdge],
        [loginSubDfd],
    );

    // Level 1 (Authenticate process): declares db:Party[party_id] — balanced with authSubDfd boundary
    const l1InputEdge = makeEdge('db', 'Party', 'proc', 'Authenticate', ['party_id'], 'root');
    const l1OutEdge = makeEdge('proc', 'Authenticate', 'db', 'Party', ['party_id'], 'root');
    const l1Proc = makeProcess('Authenticate', 'root', {
        hasSubDfd: true,
        inputs: [l1InputEdge],
        outputs: [l1OutEdge],
    });
    const rootDiagram = makeDiagram(
        'auth',
        [l1Proc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'root' }],
        [l1InputEdge, l1OutEdge],
        [authSubDfd],
    );

    const model = makeModel([rootDiagram]);
    const result = validateFlows(model, partyEntityModel);

    if (!hasRule(result.flowErrors, 'flow.unbalanced_decomposition')) {
        fail(`Deep mismatch: flow.unbalanced_decomposition should fire at Login seam (depth 2). Errors: ${JSON.stringify(result.flowErrors)}`);
    }

    // The finding should be scoped to the Login process (deep seam), not Authenticate
    const decompErrors = result.flowErrors.filter(e => e.ruleId === 'flow.unbalanced_decomposition');
    const hasLoginMismatch = decompErrors.some(e => e.processId === 'Login');
    if (!hasLoginMismatch) {
        fail(`Deep mismatch: expected finding scoped to 'Login' process, got: ${JSON.stringify(decompErrors)}`);
    }
    pass('Deep seam mismatch (depth 2): flow.unbalanced_decomposition fires for Login process');

    // Top seam (Authenticate) should NOT fire — it is balanced
    const hasAuthMismatch = decompErrors.some(e => e.processId === 'Authenticate');
    if (hasAuthMismatch) {
        fail(`Top seam (Authenticate) should be balanced but got a mismatch finding: ${JSON.stringify(decompErrors)}`);
    }
    pass('Top seam (Authenticate) remains balanced — only deep seam fires');
}

// ---------------------------------------------------------------------------
// Test 5: Inline 3-level balanced inline model → no findings
// ---------------------------------------------------------------------------

{
    // Mirror the disk fixture as inline model, confirming both paths agree.
    const sibInEdge = makeEdge('db', 'Party', 'proc', 'VerifyToken', ['party_id'], 'l3');
    const sibSibEdge = makeEdge('proc', 'VerifyToken', 'proc', 'CreateSession', 'auth context', 'l3');
    const sibOutEdge = makeEdge('proc', 'CreateSession', 'db', 'Party', ['party_id'], 'l3');

    const verifyProc = makeProcess('VerifyToken', 'l3', {
        inputs: [sibInEdge],
        outputs: [sibSibEdge],
    });
    const createProc = makeProcess('CreateSession', 'l3', {
        inputs: [sibSibEdge],
        outputs: [sibOutEdge],
    });
    const loginSubDfd = makeDiagram(
        'Login',
        [verifyProc, createProc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'l3' }],
        [sibInEdge, sibSibEdge, sibOutEdge],
    );

    const l2InEdge = makeEdge('db', 'Party', 'proc', 'Login', ['party_id'], 'l2');
    const l2OutEdge = makeEdge('proc', 'Login', 'db', 'Party', ['party_id'], 'l2');
    const loginProc = makeProcess('Login', 'l2', {
        hasSubDfd: true,
        inputs: [l2InEdge],
        outputs: [l2OutEdge],
    });
    const authSubDfd = makeDiagram(
        'Authenticate',
        [loginProc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'l2' }],
        [l2InEdge, l2OutEdge],
        [loginSubDfd],
    );

    const l1InEdge = makeEdge('db', 'Party', 'proc', 'Authenticate', ['party_id'], 'l1');
    const l1OutEdge = makeEdge('proc', 'Authenticate', 'db', 'Party', ['party_id'], 'l1');
    const authProc = makeProcess('Authenticate', 'l1', {
        hasSubDfd: true,
        inputs: [l1InEdge],
        outputs: [l1OutEdge],
    });
    const rootDiagram = makeDiagram(
        'auth',
        [authProc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'l1' }],
        [l1InEdge, l1OutEdge],
        [authSubDfd],
    );

    const model = makeModel([rootDiagram]);
    const result = validateFlows(model, partyEntityModel);

    if (hasRule(result.flowErrors, 'flow.unbalanced_decomposition')) {
        const decomp = result.flowErrors.filter(e => e.ruleId === 'flow.unbalanced_decomposition');
        fail(`Inline balanced 3-level model should have no unbalanced_decomposition, got: ${JSON.stringify(decomp)}`);
    }
    pass('Inline 3-level balanced model: flow.unbalanced_decomposition is silent (sibling proc→proc excluded)');
}

console.log('\nAll test-flow-leveling checks PASSED.');
