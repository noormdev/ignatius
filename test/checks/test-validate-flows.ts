/**
 * test-validate-flows.ts — Asserts all 11 flow.* rules fire correctly.
 *
 * - 10 rules are verified via the broken-flow fixture (parsed from disk).
 * - flow.illegal_connection is verified via an inline FlowModel literal,
 *   because the parser always attaches a process to every edge — it cannot
 *   generate store-to-store edges from valid frontmatter.
 * - All 11 rules are absent on the clean fixture.
 * - Class B stripping is verified on cleanedFlowModel.
 * - flow.unknown_attribute fires for both string and array db: data.
 * - flow.process_to_process is suppressed when config.process_to_process === false.
 * - flow.duplicate_number fires on an authored sibling local-number collision.
 */

import { parseFlows } from '../../src/flows/flow-parse';
import { validateFlows } from '../../src/flows/flow-validate';
import type { FlowError, FlowRulesConfig } from '../../src/flows/flow-validate';
import type { FlowModel, FlowDiagram, FlowEdge, FlowProcess, FlowExternal, FlowStoreRef } from '../../src/flows/flow-parse';
import type { Model, ModelNode } from '../../src/model/parse';
import { defaultTheme } from '../../src/theme/theme-defaults';
import { defaultBranding } from '../../src/theme/branding-defaults';

// ---------------------------------------------------------------------------
// Entity model helpers
// ---------------------------------------------------------------------------

function baseNode(id: string, extraCols: string[] = []): ModelNode {
    const columns: Record<string, { type: string }> = { id: { type: 'integer' } };
    for (const col of extraCols) columns[col] = { type: 'text' };
    return {
        id,
        classification: 'independent',
        pk: ['id'],
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

// Entity catalog used by broken-flow fixture tests
const entityModel = baseEntityModel([
    baseNode('Party', ['party_id', 'type']),
    baseNode('SalesOrder', ['order_id', 'party_id']),
]);

// ---------------------------------------------------------------------------
// FlowModel construction helpers for inline tests
// ---------------------------------------------------------------------------

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

function makeFlowModel(diagrams: FlowDiagram[], externals: FlowExternal[] = []): FlowModel {
    return { diagrams, modelDir: '/test', externals };
}

function hasRule(errors: FlowError[], ruleId: string): boolean {
    return errors.some(e => e.ruleId === ruleId);
}

// ---------------------------------------------------------------------------
// 1. flow.illegal_connection — inline FlowModel (store-to-store edge)
// ---------------------------------------------------------------------------

{
    const edge = makeEdge('db', 'Party', 'cache', 'Sessions');
    const proc = makeProcess('DoSomething', 'test');
    const diagram = makeDiagram(
        'test',
        [proc],
        [],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'test' }, { kind: 'cache', name: 'Sessions', displayName: 'Sessions', flowId: 'test' }],
        [edge],
    );
    const model = makeFlowModel([diagram]);
    const result = validateFlows(model, entityModel);

    if (!hasRule(result.flowErrors, 'flow.illegal_connection')) {
        console.error('FAIL: flow.illegal_connection should fire on store-to-store edge');
        process.exit(1);
    }
    console.log('PASS: flow.illegal_connection fires on store-to-store edge (inline FlowModel)');

    // Class B: illegal edge stripped from cleanedFlowModel
    const cleanDiagram = result.cleanedFlowModel.diagrams[0]!;
    const illegalSurvived = cleanDiagram.edges.some(
        e => e.from.kind !== 'proc' && e.to.kind !== 'proc',
    );
    if (illegalSurvived) {
        console.error('FAIL: illegal_connection edge should be stripped from cleanedFlowModel');
        process.exit(1);
    }
    console.log('PASS: flow.illegal_connection edge stripped from cleanedFlowModel');
}

// ---------------------------------------------------------------------------
// 2. Clean fixture — zero flow errors
// ---------------------------------------------------------------------------

{
    const result = await parseFlows('./test/fixtures/flows');
    const diagrams = result.flowModel.diagrams;

    if (diagrams.length === 0) {
        console.error('FAIL: clean fixture has no diagrams');
        process.exit(1);
    }

    const cleanEntityModel = baseEntityModel([
        baseNode('Party', ['party_id', 'type']),
    ]);
    const validation = validateFlows(result.flowModel, cleanEntityModel);

    if (validation.flowErrors.length > 0) {
        console.error('FAIL: clean fixture should have zero flow errors, got:', validation.flowErrors);
        process.exit(1);
    }
    console.log('PASS: clean fixture — zero flow errors');
}

// ---------------------------------------------------------------------------
// 3. Broken fixture — 10 parseable rules must fire
// ---------------------------------------------------------------------------

const brokenResult = await parseFlows('./test/fixtures/broken-flow');
if (brokenResult.flowModel.diagrams.length === 0) {
    console.error('FAIL: broken-flow fixture has no diagrams');
    process.exit(1);
}

const brokenValidation = validateFlows(brokenResult.flowModel, entityModel);
const brokenErrors = brokenValidation.flowErrors;

const parseableRules = [
    'flow.unknown_store',
    'flow.unknown_external',
    'flow.unknown_process',
    'flow.unknown_attribute',
    'flow.ambiguous_endpoint',
    'flow.process_no_input',
    'flow.process_no_output',
    'flow.process_to_process',
    'flow.unbalanced_decomposition',
    'flow.duplicate_number',
] as const;

for (const ruleId of parseableRules) {
    if (!hasRule(brokenErrors, ruleId)) {
        console.error(`FAIL: broken-flow fixture should fire '${ruleId}'`);
        console.error('All errors present:', [...new Set(brokenErrors.map(e => e.ruleId))].sort());
        process.exit(1);
    }
    console.log(`PASS: broken-flow fires ${ruleId}`);
}

// ---------------------------------------------------------------------------
// 4. Class B stripping — cleanedFlowModel
// ---------------------------------------------------------------------------

{
    const cleanedDiagrams = brokenValidation.cleanedFlowModel.diagrams;
    const nodeIds = new Set(entityModel.nodes.map(n => n.id));

    for (const diagram of cleanedDiagrams) {
        const externalIds = new Set(diagram.externals.map(e => e.id));
        const processIds = new Set(diagram.processes.map(p => p.id));

        for (const edge of diagram.edges) {
            // No unknown db: stores
            for (const ep of [edge.from, edge.to]) {
                if (ep.kind === 'db' && !nodeIds.has(ep.name)) {
                    console.error(`FAIL: cleanedFlowModel has edge touching unknown db: '${ep.name}'`);
                    process.exit(1);
                }
                // No unknown externals
                if (ep.kind === 'ext' && !externalIds.has(ep.name)) {
                    console.error(`FAIL: cleanedFlowModel has edge touching unknown ext: '${ep.name}'`);
                    process.exit(1);
                }
                // No unknown processes
                if (ep.kind === 'proc' && !processIds.has(ep.name)) {
                    console.error(`FAIL: cleanedFlowModel has edge touching unknown proc: '${ep.name}'`);
                    process.exit(1);
                }
            }
            // No illegal connections (both non-proc)
            if (edge.from.kind !== 'proc' && edge.to.kind !== 'proc') {
                console.error(`FAIL: cleanedFlowModel has illegal connection: ${edge.from.raw} -> ${edge.to.raw}`);
                process.exit(1);
            }
        }
    }
    console.log('PASS: Class B stripping — all Class B violations removed from cleanedFlowModel');
}

// ---------------------------------------------------------------------------
// 5. flow.unknown_attribute fires for string AND array data on db: endpoint
// ---------------------------------------------------------------------------

{
    const attrErrors = brokenErrors.filter(e => e.ruleId === 'flow.unknown_attribute');

    // Should have at least two: one for string 'bogus_column' and one for array 'another_bogus'
    if (attrErrors.length < 2) {
        console.error(`FAIL: flow.unknown_attribute should fire at least twice (string + array), got ${attrErrors.length}`);
        process.exit(1);
    }
    console.log(`PASS: flow.unknown_attribute fires for string and array db: data (${attrErrors.length} findings)`);
}

// ---------------------------------------------------------------------------
// 6. flow.process_to_process silenceable via config
// ---------------------------------------------------------------------------

{
    const defaultValidation = validateFlows(brokenResult.flowModel, entityModel);
    const silencedValidation = validateFlows(brokenResult.flowModel, entityModel, { process_to_process: false });

    if (!hasRule(defaultValidation.flowErrors, 'flow.process_to_process')) {
        console.error('FAIL: flow.process_to_process should fire by default');
        process.exit(1);
    }
    if (hasRule(silencedValidation.flowErrors, 'flow.process_to_process')) {
        console.error('FAIL: flow.process_to_process should be suppressed when config.process_to_process === false');
        process.exit(1);
    }
    console.log('PASS: flow.process_to_process silenceable via config');
}

// ---------------------------------------------------------------------------
// 7. flow.duplicate_number fires on authored sibling number collision
// ---------------------------------------------------------------------------

{
    if (!hasRule(brokenErrors, 'flow.duplicate_number')) {
        console.error('FAIL: flow.duplicate_number should fire in broken-flow fixture');
        process.exit(1);
    }
    console.log('PASS: flow.duplicate_number fires on sibling number: 1 collision');
}

// ---------------------------------------------------------------------------
// 8. RULES registry: all 11 flow.* rules present + silenceable flag correct
// ---------------------------------------------------------------------------

{
    const { RULES } = await import('../../src/model/validate');
    const flowRuleIds = [
        'flow.unknown_store',
        'flow.unknown_external',
        'flow.unknown_process',
        'flow.unknown_attribute',
        'flow.ambiguous_endpoint',
        'flow.process_no_input',
        'flow.process_no_output',
        'flow.illegal_connection',
        'flow.process_to_process',
        'flow.unbalanced_decomposition',
        'flow.duplicate_number',
    ] as const;

    for (const ruleId of flowRuleIds) {
        if (!(ruleId in RULES)) {
            console.error(`FAIL: RULES registry missing entry for '${ruleId}'`);
            process.exit(1);
        }
    }

    if (RULES['flow.process_to_process'].silenceable !== true) {
        console.error('FAIL: flow.process_to_process must have silenceable: true');
        process.exit(1);
    }

    // Only flow.process_to_process should be silenceable
    const silenceableRules = flowRuleIds.filter(id => RULES[id].silenceable === true);
    if (silenceableRules.length !== 1 || silenceableRules[0] !== 'flow.process_to_process') {
        console.error('FAIL: exactly one flow rule should be silenceable (flow.process_to_process), got:', silenceableRules);
        process.exit(1);
    }

    console.log('PASS: RULES registry has all 11 flow.* entries with correct class/silenceable');
}

// ---------------------------------------------------------------------------
// 9. formatFindingsForStderr accepts flowErrors (3rd param, optional)
// ---------------------------------------------------------------------------

{
    const { formatFindingsForStderr } = await import('../../src/model/validate');

    // Called with 2 args (existing callers) must still work
    const lines2 = formatFindingsForStderr([], []);
    if (!Array.isArray(lines2)) {
        console.error('FAIL: formatFindingsForStderr with 2 args should return array');
        process.exit(1);
    }

    // Called with 3 args (flow errors included)
    const flowErr: FlowError = {
        ruleId: 'flow.unknown_store',
        flowId: 'checkout',
        severity: 'error',
        message: 'db: store not found',
    };
    const lines3 = formatFindingsForStderr([], [], [flowErr]);
    if (!lines3.some(l => l.includes('flow.unknown_store'))) {
        console.error('FAIL: formatFindingsForStderr with flowErrors should include flow rule in output');
        process.exit(1);
    }
    console.log('PASS: formatFindingsForStderr accepts optional flowErrors 3rd param');
}

// ---------------------------------------------------------------------------
// 10. flow.unbalanced_decomposition fires for column mismatch at sub-DFD seam
// ---------------------------------------------------------------------------

{
    if (!hasRule(brokenErrors, 'flow.unbalanced_decomposition')) {
        console.error('FAIL: flow.unbalanced_decomposition should fire in broken-flow fixture');
        process.exit(1);
    }
    console.log('PASS: flow.unbalanced_decomposition fires on sub-DFD column mismatch');
}

// ---------------------------------------------------------------------------
// 11. Zero flow errors on a minimal clean inline FlowModel
// ---------------------------------------------------------------------------

{
    const procNode = makeProcess('DoIt', 'clean', {
        inputs: [makeEdge('ext', 'Customer', 'proc', 'DoIt', 'order', 'clean')],
        outputs: [makeEdge('proc', 'DoIt', 'db', 'Party', ['party_id'], 'clean')],
    });
    const diagram = makeDiagram(
        'clean',
        [procNode],
        [{ id: 'Customer', label: 'Customer', body: '', bodyHtml: '', flowId: 'clean' }],
        [{ kind: 'db', name: 'Party', displayName: 'Party', flowId: 'clean' }],
        [
            makeEdge('ext', 'Customer', 'proc', 'DoIt', 'order', 'clean'),
            makeEdge('proc', 'DoIt', 'db', 'Party', ['party_id'], 'clean'),
        ],
    );
    // Pass the global external registry so the validator can confirm ext:Customer is defined.
    const globalExternals: FlowExternal[] = [{ id: 'Customer', label: 'Customer', body: '', bodyHtml: '', flowId: '' }];
    const cleanModel = makeFlowModel([diagram], globalExternals);
    const cleanEntityModel = baseEntityModel([
        baseNode('Party', ['party_id', 'type']),
    ]);
    const result = validateFlows(cleanModel, cleanEntityModel);

    if (result.flowErrors.length > 0) {
        console.error('FAIL: clean inline model should have zero flow errors, got:', result.flowErrors);
        process.exit(1);
    }
    console.log('PASS: zero flow errors on clean inline FlowModel');
}

console.log('\nAll test-validate-flows assertions passed.');
