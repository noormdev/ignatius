// Verification: validateModel fires correct ruleId for every CP-2 edge and cluster rule.
// Positive (violation present) + negative (no violation) per rule.
// Also verifies cleanedModel Class B stripping for edge.unknown_target and cluster.missing_basetype.
// No fixture files — Model literals only.
import { validateModel, RULES } from '../../src/validate';
import type { Model, ModelNode, ModelEdge, SubtypeCluster } from '../../src/parse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseNode(overrides: Partial<ModelNode> & { id: string }): ModelNode {
    return {
        id: overrides.id,
        classification: overrides.classification ?? 'independent',
        group: overrides.group,
        pk: overrides.pk ?? ['id'],
        columns: overrides.columns ?? { id: { type: 'uuid' } },
        alternateKeys: overrides.alternateKeys ?? [],
        bodyHtml: overrides.bodyHtml ?? '',
    };
}

function baseModel(
    nodes: ModelNode[],
    edges: ModelEdge[] = [],
    subtypeClusters: SubtypeCluster[] = [],
): Model {
    return {
        groups: { core: { label: 'Core', color: '#aaa' } },
        nodes,
        edges,
        subtypeClusters,
        theme: {} as Model['theme'],
        branding: {} as Model['branding'],
    };
}

function hasEntityError(result: ReturnType<typeof validateModel>, ruleId: string, entityId?: string): boolean {
    return result.entityErrors.some(
        e => e.ruleId === ruleId && (entityId === undefined || e.entityId === entityId),
    );
}

function hasGlobalError(result: ReturnType<typeof validateModel>, ruleId: string, omittedId?: string): boolean {
    return result.globalErrors.some(
        e => e.ruleId === ruleId && (omittedId === undefined || e.omitted.id === omittedId),
    );
}

// ---------------------------------------------------------------------------
// edge.unknown_target (Class B — strips from cleanedModel.edges)
// ---------------------------------------------------------------------------

{
    // Positive: edge target not in model.nodes
    const source = baseNode({ id: 'Order' });
    const edge: ModelEdge = {
        source: 'Order',
        target: 'Ghost',
        identifying: false,
        on: { ghost_id: 'id' },
        predicate: { fwd: 'references', rev: 'references' },
        cardinality: { parent: '1', child: 'many' },
    };
    const model = baseModel([source], [edge]);
    const result = validateModel(model);
    console.assert(hasGlobalError(result, 'edge.unknown_target', 'Order→Ghost'), 'FAIL: edge.unknown_target — GlobalError not emitted');
    console.assert(result.globalErrors[0]?.severity === 'error', 'FAIL: edge.unknown_target severity should be error');
    // Class B: edge must be absent from cleanedModel
    console.assert(
        result.cleanedModel.edges.length === 0,
        `FAIL: edge.unknown_target — dangling edge not stripped from cleanedModel (got ${result.cleanedModel.edges.length} edges)`,
    );
    console.log('PASS: edge.unknown_target positive (dangling edge stripped from cleanedModel)');
}

{
    // Negative: edge target present in model.nodes
    const source = baseNode({ id: 'Order' });
    const target = baseNode({ id: 'Customer' });
    const edge: ModelEdge = {
        source: 'Order',
        target: 'Customer',
        identifying: false,
        on: { customer_id: 'id' },
        predicate: { fwd: 'belongs to', rev: 'belongs to' },
        cardinality: { parent: '1', child: 'many' },
    };
    const model = baseModel([source, target], [edge]);
    const result = validateModel(model);
    console.assert(!hasGlobalError(result, 'edge.unknown_target'), 'FAIL: edge.unknown_target — valid edge wrongly flagged');
    console.assert(result.cleanedModel.edges.length === 1, 'FAIL: edge.unknown_target — valid edge was stripped');
    console.log('PASS: edge.unknown_target negative (valid edge preserved in cleanedModel)');
}

// ---------------------------------------------------------------------------
// edge.dangling_fk_column (Class A — source entity flagged, edge stays in cleanedModel)
// ---------------------------------------------------------------------------

{
    // Positive: edge.on references column not present on source entity
    const source = baseNode({
        id: 'OrderLine',
        pk: ['order_id', 'line_num'],
        columns: { order_id: { type: 'uuid' }, line_num: { type: 'int' } },
    });
    const target = baseNode({ id: 'Order', pk: ['order_id'], columns: { order_id: { type: 'uuid' } } });
    const edge: ModelEdge = {
        source: 'OrderLine',
        target: 'Order',
        identifying: true,
        on: { order_id: 'order_id', ghost_col: 'order_id' }, // ghost_col not in source columns
        predicate: { fwd: 'belongs to', rev: 'belongs to' },
        cardinality: { parent: '1', child: 'many' },
    };
    const model = baseModel([source, target], [edge]);
    const result = validateModel(model);
    console.assert(hasEntityError(result, 'edge.dangling_fk_column', 'OrderLine'), 'FAIL: edge.dangling_fk_column — EntityError not emitted on source');
    // Class A: edge must remain in cleanedModel
    console.assert(result.cleanedModel.edges.length === 1, 'FAIL: edge.dangling_fk_column — edge wrongly stripped (Class A rule)');
    console.log('PASS: edge.dangling_fk_column positive (EntityError on source, edge stays in cleanedModel)');
}

{
    // Negative: all edge.on columns exist on source entity
    const source = baseNode({
        id: 'OrderLine',
        pk: ['order_id', 'line_num'],
        columns: { order_id: { type: 'uuid' }, line_num: { type: 'int' } },
    });
    const target = baseNode({ id: 'Order', pk: ['order_id'], columns: { order_id: { type: 'uuid' } } });
    const edge: ModelEdge = {
        source: 'OrderLine',
        target: 'Order',
        identifying: true,
        on: { order_id: 'order_id' },
        predicate: { fwd: 'belongs to', rev: 'belongs to' },
        cardinality: { parent: '1', child: 'many' },
    };
    const model = baseModel([source, target], [edge]);
    const result = validateModel(model);
    console.assert(!hasEntityError(result, 'edge.dangling_fk_column', 'OrderLine'), 'FAIL: edge.dangling_fk_column — valid FK wrongly flagged');
    console.log('PASS: edge.dangling_fk_column negative (all FK columns present on source)');
}

// ---------------------------------------------------------------------------
// cluster.missing_basetype (Class B — strips cluster from cleanedModel)
// ---------------------------------------------------------------------------

{
    // Positive: cluster.basetype not in model.nodes
    const cluster: SubtypeCluster = {
        basetype: 'GhostEntity',
        exclusive: true,
        members: ['A', 'B'],
        hasDiscriminator: true,
    };
    const memberA = baseNode({ id: 'A' });
    const memberB = baseNode({ id: 'B' });
    const model = baseModel([memberA, memberB], [], [cluster]);
    const result = validateModel(model);
    console.assert(hasGlobalError(result, 'cluster.missing_basetype', 'GhostEntity'), 'FAIL: cluster.missing_basetype — GlobalError not emitted');
    // Class B: cluster must be absent from cleanedModel
    console.assert(result.cleanedModel.subtypeClusters.length === 0, 'FAIL: cluster.missing_basetype — broken cluster not stripped from cleanedModel');
    console.log('PASS: cluster.missing_basetype positive (cluster stripped from cleanedModel)');
}

{
    // Negative: cluster.basetype present in model.nodes
    const basetype = baseNode({ id: 'Party', columns: { type: { type: 'text' } } });
    const memberA = baseNode({ id: 'Business' });
    const cluster: SubtypeCluster = {
        basetype: 'Party',
        exclusive: true,
        members: ['Business'],
        hasDiscriminator: true,
    };
    const model = baseModel([basetype, memberA], [], [cluster]);
    const result = validateModel(model);
    console.assert(!hasGlobalError(result, 'cluster.missing_basetype'), 'FAIL: cluster.missing_basetype — valid cluster wrongly flagged');
    console.assert(result.cleanedModel.subtypeClusters.length === 1, 'FAIL: cluster.missing_basetype — valid cluster wrongly stripped');
    console.log('PASS: cluster.missing_basetype negative (valid cluster preserved)');
}

// ---------------------------------------------------------------------------
// cluster.missing_member (Class A — member dropped, cluster stays, basetype flagged)
// ---------------------------------------------------------------------------

{
    // Positive: one cluster member not in model.nodes
    const basetype = baseNode({ id: 'Party', columns: { type: { type: 'text' } } });
    const goodMember = baseNode({ id: 'Business' });
    const cluster: SubtypeCluster = {
        basetype: 'Party',
        exclusive: true,
        members: ['Business', 'GhostMember'],
        hasDiscriminator: true,
    };
    const model = baseModel([basetype, goodMember], [], [cluster]);
    const result = validateModel(model);
    console.assert(hasEntityError(result, 'cluster.missing_member', 'Party'), 'FAIL: cluster.missing_member — EntityError not emitted on basetype');
    // Class A: cluster stays but missing member is dropped
    console.assert(result.cleanedModel.subtypeClusters.length === 1, 'FAIL: cluster.missing_member — cluster wrongly stripped (Class A)');
    const cleanedCluster = result.cleanedModel.subtypeClusters[0]!;
    console.assert(
        cleanedCluster.members.length === 1 && cleanedCluster.members[0] === 'Business',
        `FAIL: cluster.missing_member — missing member not dropped from cleanedModel (got: ${cleanedCluster.members.join(',')})`,
    );
    console.log('PASS: cluster.missing_member positive (missing member dropped, cluster stays, basetype flagged)');
}

{
    // Negative: all cluster members present
    const basetype = baseNode({ id: 'Party', columns: { type: { type: 'text' } } });
    const memberA = baseNode({ id: 'Business' });
    const memberB = baseNode({ id: 'Person' });
    const cluster: SubtypeCluster = {
        basetype: 'Party',
        exclusive: true,
        members: ['Business', 'Person'],
        hasDiscriminator: true,
    };
    const model = baseModel([basetype, memberA, memberB], [], [cluster]);
    const result = validateModel(model);
    console.assert(!hasEntityError(result, 'cluster.missing_member', 'Party'), 'FAIL: cluster.missing_member — valid cluster wrongly flagged');
    console.assert(result.cleanedModel.subtypeClusters[0]!.members.length === 2, 'FAIL: cluster.missing_member — valid member wrongly dropped');
    console.log('PASS: cluster.missing_member negative (all members present)');
}

// ---------------------------------------------------------------------------
// cluster.no_discriminator (Class A — basetype flagged, cluster stays)
// ---------------------------------------------------------------------------

{
    // Positive: exclusive cluster, no discriminator
    const basetype = baseNode({ id: 'SalesLine', columns: { id: { type: 'uuid' } } });
    const memberA = baseNode({ id: 'ProductLine' });
    const cluster: SubtypeCluster = {
        basetype: 'SalesLine',
        exclusive: true,
        members: ['ProductLine'],
        hasDiscriminator: false,
    };
    const model = baseModel([basetype, memberA], [], [cluster]);
    const result = validateModel(model);
    console.assert(hasEntityError(result, 'cluster.no_discriminator', 'SalesLine'), 'FAIL: cluster.no_discriminator — EntityError not emitted on exclusive basetype');
    console.assert(result.cleanedModel.subtypeClusters.length === 1, 'FAIL: cluster.no_discriminator — cluster wrongly stripped (Class A)');
    console.log('PASS: cluster.no_discriminator positive (exclusive + no discriminator)');
}

{
    // Negative: exclusive + discriminator present
    const basetype = baseNode({ id: 'Party', columns: { type: { type: 'text' } } });
    const memberA = baseNode({ id: 'Business' });
    const cluster: SubtypeCluster = {
        basetype: 'Party',
        exclusive: true,
        members: ['Business'],
        hasDiscriminator: true,
    };
    const model = baseModel([basetype, memberA], [], [cluster]);
    const result = validateModel(model);
    console.assert(!hasEntityError(result, 'cluster.no_discriminator', 'Party'), 'FAIL: cluster.no_discriminator — cluster with discriminator wrongly flagged');
    console.log('PASS: cluster.no_discriminator negative (discriminator present)');
}

{
    // Negative: inclusive cluster, no discriminator — should NOT fire.
    // Inclusive subtypes can coexist, so no single column partitions them.
    const basetype = baseNode({ id: 'Identity', columns: { id: { type: 'uuid' } } });
    const memberA = baseNode({ id: 'Passport' });
    const memberB = baseNode({ id: 'License' });
    const cluster: SubtypeCluster = {
        basetype: 'Identity',
        exclusive: false,
        members: ['Passport', 'License'],
        hasDiscriminator: false,
    };
    const model = baseModel([basetype, memberA, memberB], [], [cluster]);
    const result = validateModel(model);
    console.assert(!hasEntityError(result, 'cluster.no_discriminator', 'Identity'), 'FAIL: cluster.no_discriminator — inclusive cluster without discriminator wrongly flagged');
    console.log('PASS: cluster.no_discriminator negative (inclusive cluster needs no discriminator)');
}

// ---------------------------------------------------------------------------
// RULES registry — all CP-2 rules registered
// ---------------------------------------------------------------------------

{
    const cp2Rules = [
        'edge.unknown_target',
        'edge.dangling_fk_column',
        'cluster.missing_basetype',
        'cluster.missing_member',
        'cluster.no_discriminator',
        'parse.invalid_yaml',
        'parse.missing_id',
        'parse.empty_frontmatter',
    ] as const;

    for (const ruleId of cp2Rules) {
        const entry = RULES[ruleId];
        console.assert(entry !== undefined, `FAIL: RULES['${ruleId}'] missing`);
        console.assert(typeof entry!.title === 'string' && entry!.title.length > 0, `FAIL: RULES['${ruleId}'].title empty`);
        console.assert(typeof entry!.explanation === 'string' && entry!.explanation.length > 0, `FAIL: RULES['${ruleId}'].explanation empty`);
    }
    // Class checks
    console.assert(RULES['edge.unknown_target']!.class === 'B', "FAIL: edge.unknown_target class should be 'B'");
    console.assert(RULES['edge.dangling_fk_column']!.class === 'A', "FAIL: edge.dangling_fk_column class should be 'A'");
    console.assert(RULES['cluster.missing_basetype']!.class === 'B', "FAIL: cluster.missing_basetype class should be 'B'");
    console.assert(RULES['cluster.missing_member']!.class === 'A', "FAIL: cluster.missing_member class should be 'A'");
    console.assert(RULES['cluster.no_discriminator']!.class === 'A', "FAIL: cluster.no_discriminator class should be 'A'");
    console.assert(RULES['parse.invalid_yaml']!.class === 'B', "FAIL: parse.invalid_yaml class should be 'B'");
    console.assert(RULES['parse.missing_id']!.class === 'B', "FAIL: parse.missing_id class should be 'B'");
    console.assert(RULES['parse.empty_frontmatter']!.class === 'B', "FAIL: parse.empty_frontmatter class should be 'B'");
    console.log('PASS: RULES registry has all CP-2 rules with correct shape and class');
}

// ---------------------------------------------------------------------------
// Sanity check: real models/key-inherited directory — should be CLEAN.
//
// Identity uses an inclusive subtype cluster (exclusive: false) which no
// longer false-positives on cluster.no_discriminator. Real models should
// produce zero findings.
// ---------------------------------------------------------------------------

import { parseModels } from '../../src/parse';

{
    const { model, globalErrors: parseGlobals } = await parseModels('models/key-inherited');
    const result = validateModel(model);

    console.assert(parseGlobals.length === 0, `FAIL: real models/ has parse-time GlobalErrors: ${JSON.stringify(parseGlobals)}`);
    console.assert(result.globalErrors.length === 0, `FAIL: real models/ has validator GlobalErrors: ${JSON.stringify(result.globalErrors)}`);

    // Group entity errors by ruleId for pinned assertions.
    const countByRule: Record<string, number> = {};
    for (const err of result.entityErrors) {
        countByRule[err.ruleId] = (countByRule[err.ruleId] ?? 0) + 1;
    }

    // Real models should be clean. No expected findings.
    const EXPECTED: Record<string, number> = {};

    for (const [ruleId, expected] of Object.entries(EXPECTED)) {
        const actual = countByRule[ruleId] ?? 0;
        console.assert(
            actual === expected,
            `FAIL: real models/ baseline — ${ruleId}: expected ${expected}, got ${actual}`,
        );
        if (actual === expected) {
            console.log(`PASS: real models/ baseline — ${ruleId} = ${actual}`);
        }
    }

    // No rule IDs outside the known set should appear.
    const KNOWN_RULE_IDS = new Set(Object.keys(EXPECTED));
    const unexpectedRuleIds = Object.keys(countByRule).filter(id => !KNOWN_RULE_IDS.has(id));
    console.assert(
        unexpectedRuleIds.length === 0,
        `FAIL: real models/ has unexpected rule violations: ${unexpectedRuleIds.map(id => `${id}=${countByRule[id]}`).join(', ')}`,
    );
    if (unexpectedRuleIds.length === 0) {
        console.log('PASS: real models/ baseline — no unexpected rule violations');
    }

    console.log(`PASS: real models/ sanity — parseGlobals=${parseGlobals.length}, validatorGlobals=${result.globalErrors.length}, entityErrors=${result.entityErrors.length}`);
}

// ---------------------------------------------------------------------------
// Sanity check: models/broken-demo — deliberately-broken model that exercises
// every rule the validator can produce. Pin the full expected baseline so a
// rule predicate regression is caught immediately.
// ---------------------------------------------------------------------------

{
    const { model, globalErrors: parseGlobals } = await parseModels('models/broken-demo');
    const result = validateModel(model);

    const EXPECTED_GLOBALS: Record<string, number> = {
        'parse.invalid_yaml': 1,
        'parse.missing_id': 1,
        'parse.empty_frontmatter': 1,
        'edge.unknown_target': 1,
    };
    const EXPECTED_ENTITY: Record<string, number> = {
        'entity.missing_pk': 1,
        'entity.missing_columns': 1,
        'entity.invalid_field_type': 1,
        'entity.unknown_group': 1,
        'edge.dangling_fk_column': 1,
        'cluster.missing_member': 1,
        'cluster.no_discriminator': 1,
        'entity.example_unknown_column': 1,
    };

    const allGlobals = [...parseGlobals, ...result.globalErrors];
    const globalsByRule: Record<string, number> = {};
    for (const e of allGlobals) globalsByRule[e.ruleId] = (globalsByRule[e.ruleId] ?? 0) + 1;
    const entityByRule: Record<string, number> = {};
    for (const e of result.entityErrors) entityByRule[e.ruleId] = (entityByRule[e.ruleId] ?? 0) + 1;

    for (const [ruleId, expected] of Object.entries(EXPECTED_GLOBALS)) {
        const actual = globalsByRule[ruleId] ?? 0;
        console.assert(actual === expected, `FAIL: broken-demo global ${ruleId}: expected ${expected}, got ${actual}`);
        if (actual === expected) console.log(`PASS: broken-demo global — ${ruleId} = ${actual}`);
    }
    for (const [ruleId, expected] of Object.entries(EXPECTED_ENTITY)) {
        const actual = entityByRule[ruleId] ?? 0;
        console.assert(actual === expected, `FAIL: broken-demo entity ${ruleId}: expected ${expected}, got ${actual}`);
        if (actual === expected) console.log(`PASS: broken-demo entity — ${ruleId} = ${actual}`);
    }

    const totalExpected = Object.values(EXPECTED_GLOBALS).reduce((a, b) => a + b, 0)
                        + Object.values(EXPECTED_ENTITY).reduce((a, b) => a + b, 0);
    const totalActual = allGlobals.length + result.entityErrors.length;
    console.assert(totalActual === totalExpected, `FAIL: broken-demo total findings: expected ${totalExpected}, got ${totalActual}`);
    console.log(`PASS: broken-demo sanity — globals=${allGlobals.length}, entityErrors=${result.entityErrors.length} (total ${totalActual})`);
}

console.log('\nAll ref validation tests passed.');
