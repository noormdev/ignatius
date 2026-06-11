/**
 * flow-validate.ts — Pure validator for FlowModel.
 *
 * No Node/Bun I/O; imports only types. Browser-safe.
 * Mirrors the structure of validate.ts for the ERD layer.
 *
 * All 11 flow.* rules are implemented here as pure functions.
 * Class B rules strip edges/stores from cleanedFlowModel.
 * Class A rules record findings but strip nothing.
 */

import type { Model } from '../model/parse';
import type { GlobalError, RuleId } from '../model/validate';
import type {
    FlowEndpoint,
    FlowModel,
    FlowDiagram,
    FlowEdge,
    FlowProcess,
    FlowStoreRef,
} from './flow-parse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Narrows a FlowEndpoint kind to the subset that can appear in a FlowStoreRef. */
function isStoreKind(k: FlowEndpoint['kind']): k is FlowStoreRef['kind'] {
    return k !== 'proc' && k !== 'ext';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowRulesConfig = {
    /** When false, flow.process_to_process is suppressed. Default: true (rule fires). */
    process_to_process?: boolean;
};

export type FlowError = {
    ruleId: RuleId;
    /** The DFD id (folder name under flows/) this finding belongs to. */
    flowId: string;
    /** The process id within the DFD, when the finding is process-scoped. */
    processId?: string;
    severity: 'warning' | 'error';
    message: string;
};

export type FlowValidationResult = {
    flowErrors: FlowError[];
    /** Reserved; always empty today. Typed GlobalError[] so callers can push global-scope flow errors when needed. */
    globalErrors: GlobalError[];
    cleanedFlowModel: FlowModel;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collect all column names for an entity: pk names + columns keys. */
function entityColumns(
    entityId: string,
    entityModel: Model,
): Set<string> | null {
    const node = entityModel.nodes.find(n => n.id === entityId);
    if (!node) return null;
    const cols = new Set<string>();
    for (const col of (node.pk ?? [])) cols.add(col);
    for (const key of Object.keys(node.columns ?? {})) cols.add(key);
    return cols;
}

/** Normalize FlowData to an array of strings. Empty string = no data = empty array. */
function toColumnList(data: string | string[]): string[] {
    if (Array.isArray(data)) return data.filter(s => s.length > 0);
    if (data.length === 0) return [];
    return [data];
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * flow.unknown_store (Class B)
 * A db: endpoint whose name is not in the entity catalog.
 * Strips all edges touching the unknown store.
 */
function checkUnknownStore(
    diagram: FlowDiagram,
    entityModel: Model,
): { errors: FlowError[]; strippedEdgeIds: Set<number> } {
    const nodeIds = new Set(entityModel.nodes.map(n => n.id));
    const errors: FlowError[] = [];
    const strippedEdgeIds = new Set<number>();

    diagram.edges.forEach((edge, idx) => {
        // Collect all unknown db: endpoint names for this edge before emitting,
        // so one edge with two unknown stores produces only one finding.
        const unknownNames: string[] = [];
        for (const ep of [edge.from, edge.to]) {
            if (ep.kind !== 'db') continue;
            if (nodeIds.has(ep.name)) continue;
            unknownNames.push(ep.name);
        }
        if (unknownNames.length === 0) return;
        errors.push({
            ruleId: 'flow.unknown_store',
            flowId: diagram.id,
            severity: 'error',
            message: `db: store '${unknownNames.join("', '")}' not found in entity catalog.`,
        });
        strippedEdgeIds.add(idx);
    });

    return { errors, strippedEdgeIds };
}

/**
 * flow.unknown_external (Class B)
 * An ext: endpoint whose name has no corresponding FlowExternal in the diagram.
 * Strips all edges touching the unknown external.
 */
function checkUnknownExternal(
    diagram: FlowDiagram,
    strippedEdgeIds: Set<number>,
): { errors: FlowError[]; newStripped: Set<number> } {
    const externalIds = new Set(diagram.externals.map(e => e.id));
    const errors: FlowError[] = [];
    const newStripped = new Set<number>(strippedEdgeIds);

    diagram.edges.forEach((edge, idx) => {
        if (strippedEdgeIds.has(idx)) return;
        for (const ep of [edge.from, edge.to]) {
            if (ep.kind !== 'ext') continue;
            if (externalIds.has(ep.name)) continue;
            errors.push({
                ruleId: 'flow.unknown_external',
                flowId: diagram.id,
                severity: 'error',
                message: `ext: '${ep.name}' not found in _externals/ for DFD '${diagram.id}'.`,
            });
            newStripped.add(idx);
        }
    });

    return { errors, newStripped };
}

/**
 * flow.unknown_process (Class B)
 * A proc: endpoint whose name does not match any process in the diagram.
 * Strips all edges touching the unknown process.
 */
function checkUnknownProcess(
    diagram: FlowDiagram,
    strippedEdgeIds: Set<number>,
): { errors: FlowError[]; newStripped: Set<number> } {
    const processIds = new Set(diagram.processes.map(p => p.id));
    const errors: FlowError[] = [];
    const newStripped = new Set<number>(strippedEdgeIds);

    diagram.edges.forEach((edge, idx) => {
        if (strippedEdgeIds.has(idx)) return;
        for (const ep of [edge.from, edge.to]) {
            if (ep.kind !== 'proc') continue;
            if (processIds.has(ep.name)) continue;
            errors.push({
                ruleId: 'flow.unknown_process',
                flowId: diagram.id,
                severity: 'error',
                message: `proc: '${ep.name}' not found among processes in DFD '${diagram.id}'.`,
            });
            newStripped.add(idx);
        }
    });

    return { errors, newStripped };
}

/**
 * flow.illegal_connection (Class B)
 * An edge where neither endpoint is a process.
 * Covers store↔store, ext↔store, ext↔ext.
 * Strips the offending edge.
 */
function checkIllegalConnection(
    diagram: FlowDiagram,
    strippedEdgeIds: Set<number>,
): { errors: FlowError[]; newStripped: Set<number> } {
    const errors: FlowError[] = [];
    const newStripped = new Set<number>(strippedEdgeIds);

    diagram.edges.forEach((edge, idx) => {
        if (strippedEdgeIds.has(idx)) return;
        if (edge.from.kind !== 'proc' && edge.to.kind !== 'proc') {
            errors.push({
                ruleId: 'flow.illegal_connection',
                flowId: diagram.id,
                severity: 'error',
                message: `Illegal direct connection from '${edge.from.raw}' to '${edge.to.raw}' — neither endpoint is a process.`,
            });
            newStripped.add(idx);
        }
    });

    return { errors, newStripped };
}

/**
 * flow.unknown_attribute (Class A)
 * A db: flow edge whose data names a column absent from the entity.
 * Fires for both string and array data on a db: endpoint.
 * Does not strip anything.
 */
function checkUnknownAttributes(
    diagram: FlowDiagram,
    entityModel: Model,
    activeEdges: FlowEdge[],
): FlowError[] {
    const errors: FlowError[] = [];

    for (const edge of activeEdges) {
        // Find the process on either end for processId attribution
        const procEp = edge.from.kind === 'proc' ? edge.from : edge.to.kind === 'proc' ? edge.to : null;
        const dbEp = edge.from.kind === 'db' ? edge.from : edge.to.kind === 'db' ? edge.to : null;

        if (!dbEp) continue;

        const cols = entityColumns(dbEp.name, entityModel);
        if (!cols) continue; // unknown_store already fired for this entity

        const dataColumns = toColumnList(edge.data);
        for (const col of dataColumns) {
            if (cols.has(col)) continue;
            errors.push({
                ruleId: 'flow.unknown_attribute',
                flowId: diagram.id,
                ...(procEp ? { processId: procEp.name } : {}),
                severity: 'warning',
                message: `Column '${col}' on '${dbEp.name}' not found in entity pk or columns.`,
            });
        }
    }

    return errors;
}

/**
 * flow.ambiguous_endpoint (Class A)
 * A bare endpoint name that was provisionally set to 'proc' by parseEndpoint
 * but collides with another namespace.
 *
 * Strategy: we detect bare names by checking if the endpoint's raw string
 * does NOT contain a colon. In that case we check if the resolved name
 * exists in multiple namespaces — if so, it's ambiguous.
 *
 * Note: in the current parser, bare names are provisionally set to kind='proc'.
 * Here we detect them by raw string (no colon). We then cross-check namespaces.
 */
function checkAmbiguousEndpoints(
    diagram: FlowDiagram,
    activeEdges: FlowEdge[],
): FlowError[] {
    const externalIds = new Set(diagram.externals.map(e => e.id));
    const processIds = new Set(diagram.processes.map(p => p.id));
    const storeNames = new Set(diagram.storeRefs.map(s => s.name));

    const errors: FlowError[] = [];
    const reported = new Set<string>();

    for (const edge of activeEdges) {
        for (const ep of [edge.from, edge.to]) {
            // A bare endpoint has no colon in raw
            if (ep.raw.includes(':')) continue;

            const name = ep.name;
            if (reported.has(name)) continue;

            const namespaceCount =
                (externalIds.has(name) ? 1 : 0) +
                (storeNames.has(name) ? 1 : 0) +
                (processIds.has(name) ? 1 : 0);

            if (namespaceCount >= 2) {
                reported.add(name);
                errors.push({
                    ruleId: 'flow.ambiguous_endpoint',
                    flowId: diagram.id,
                    severity: 'warning',
                    message: `Bare endpoint '${name}' is ambiguous — it exists in ${namespaceCount} namespaces. Use a qualified prefix (ext:, db:, proc:, etc.).`,
                });
            }
        }
    }

    return errors;
}

/**
 * flow.process_to_process (Class A, silenceable)
 * An edge where both endpoints are proc:.
 * Skipped when config.process_to_process === false.
 */
function checkProcessToProcess(
    diagram: FlowDiagram,
    activeEdges: FlowEdge[],
    config: FlowRulesConfig,
): FlowError[] {
    if (config.process_to_process === false) return [];
    const errors: FlowError[] = [];

    for (const edge of activeEdges) {
        if (edge.from.kind === 'proc' && edge.to.kind === 'proc') {
            errors.push({
                ruleId: 'flow.process_to_process',
                flowId: diagram.id,
                processId: edge.from.name,
                severity: 'warning',
                message: `Direct process-to-process flow from '${edge.from.name}' to '${edge.to.name}'. Use an intermediate store or silence with flow_rules.process_to_process: false.`,
            });
        }
    }

    return errors;
}

/**
 * flow.process_no_input / flow.process_no_output (Class A)
 * A process with zero input or zero output edges after Class B stripping.
 */
function checkProcessIsolation(
    diagram: FlowDiagram,
    activeEdges: FlowEdge[],
): FlowError[] {
    const errors: FlowError[] = [];

    for (const proc of diagram.processes) {
        const inputs = activeEdges.filter(e => e.to.kind === 'proc' && e.to.name === proc.id);
        const outputs = activeEdges.filter(e => e.from.kind === 'proc' && e.from.name === proc.id);

        if (inputs.length === 0) {
            errors.push({
                ruleId: 'flow.process_no_input',
                flowId: diagram.id,
                processId: proc.id,
                severity: 'warning',
                message: `Process '${proc.id}' has no input flows.`,
            });
        }

        if (outputs.length === 0) {
            errors.push({
                ruleId: 'flow.process_no_output',
                flowId: diagram.id,
                processId: proc.id,
                severity: 'warning',
                message: `Process '${proc.id}' has no output flows.`,
            });
        }
    }

    return errors;
}

/**
 * flow.duplicate_number (Class A)
 * Two sibling processes in the same diagram with the same authored local number:.
 * Folder-order fallbacks are distinct by construction and never fire this rule
 * (only authored number: collisions are checked).
 */
function checkDuplicateNumbers(diagram: FlowDiagram): FlowError[] {
    // Only check processes that have an *authored* number: (number !== undefined)
    const numbered = diagram.processes.filter(p => p.number !== undefined);
    const seen = new Map<number, string>(); // number → first processId
    const errors: FlowError[] = [];

    for (const proc of numbered) {
        const n = proc.number!;
        const first = seen.get(n);
        if (first !== undefined) {
            errors.push({
                ruleId: 'flow.duplicate_number',
                flowId: diagram.id,
                processId: proc.id,
                severity: 'warning',
                message: `Process '${proc.id}' has the same local number: ${n} as '${first}' in DFD '${diagram.id}'.`,
            });
        } else {
            seen.set(n, proc.id);
        }
    }

    return errors;
}

/**
 * flow.unbalanced_decomposition (Class A, recursive)
 *
 * For each process with hasSubDfd === true at ANY depth, compare the column
 * set crossing the sub-DFD's boundary against the parent process's own
 * inputs+outputs columns for those same outside connections.
 *
 * Comparison is column-level, keyed on resolved FlowEndpoint.name.
 * Sibling-internal flows (proc→proc within the sub-DFD) are excluded.
 *
 * Recursion lives in validateDiagram, which calls this once per seam at
 * every depth and then recurses into the sub-DFD.
 *
 * Boundary-endpoint picker (hardened):
 *   - edge.from is a sub-proc → outside endpoint is edge.to
 *   - edge.to is a sub-proc  → outside endpoint is edge.from
 *   - neither is a sub-proc  → both endpoints are outside; pick the db: one
 *                              if present, otherwise skip (non-db both-outside
 *                              edges carry opaque labels, not columns)
 *   - both are sub-procs     → excluded by the boundaryEdges filter (sibling
 *                              internal; never reaches this picker)
 */
function checkUnbalancedDecomposition(
    diagram: FlowDiagram,
    parentProcess: FlowProcess,
    subDiagram: FlowDiagram,
): FlowError[] {
    // Collect the set of process ids inside the sub-DFD
    const subProcessIds = new Set(subDiagram.processes.map(p => p.id));

    // Boundary edges: sub-DFD edges where at least one endpoint is NOT a
    // sub-process (i.e. it references something outside the sub-DFD).
    // Sibling-internal flows (proc→proc where both are sub-processes) are excluded.
    const boundaryEdges = subDiagram.edges.filter(edge => {
        const fromIsSubProc = edge.from.kind === 'proc' && subProcessIds.has(edge.from.name);
        const toIsSubProc = edge.to.kind === 'proc' && subProcessIds.has(edge.to.name);
        // Exclude sibling-internal: both sides are sub-processes
        if (fromIsSubProc && toIsSubProc) return false;
        // Include if either side is external to the sub-DFD
        return !fromIsSubProc || !toIsSubProc;
    });

    // Hardened outside-endpoint picker.
    // Returns the db: endpoint(s) we should measure for column balancing.
    // A boundary edge may have zero, one, or (in the neither-is-sub-proc case)
    // potentially two outside endpoints — we always collect all db: ones.
    function outsideDbEndpoints(edge: FlowEdge): FlowEdge['from'][] {
        const fromIsSubProc = edge.from.kind === 'proc' && subProcessIds.has(edge.from.name);
        const toIsSubProc = edge.to.kind === 'proc' && subProcessIds.has(edge.to.name);

        if (fromIsSubProc && !toIsSubProc) {
            // Normal case: from is inside sub-DFD, to is outside
            return edge.to.kind === 'db' ? [edge.to] : [];
        }
        if (toIsSubProc && !fromIsSubProc) {
            // Reverse case: to is inside sub-DFD, from is outside
            return edge.from.kind === 'db' ? [edge.from] : [];
        }
        // Neither is a sub-proc (both outside): collect any db: endpoints.
        // This is an unusual edge (illegal connections are Class B stripped,
        // so after stripping this would be a proc-to-external etc.) but we
        // handle it deterministically rather than crashing.
        const result: FlowEdge['from'][] = [];
        if (edge.from.kind === 'db') result.push(edge.from);
        if (edge.to.kind === 'db') result.push(edge.to);
        return result;
    }

    // Build column set crossing the boundary, keyed per outside db: endpoint name.
    // Only db: endpoints carry column semantics — non-db data is opaque labels,
    // not column names, so they are excluded from balancing comparisons.
    const boundaryColsByEndpoint = new Map<string, Set<string>>();
    for (const edge of boundaryEdges) {
        for (const dbEp of outsideDbEndpoints(edge)) {
            const key = dbEp.name;
            if (!boundaryColsByEndpoint.has(key)) boundaryColsByEndpoint.set(key, new Set());
            for (const col of toColumnList(edge.data)) {
                boundaryColsByEndpoint.get(key)!.add(col);
            }
        }
    }

    // Build column set from parent process inputs+outputs for matching outside db: endpoints.
    const parentColsByEndpoint = new Map<string, Set<string>>();
    for (const edge of [...parentProcess.inputs, ...parentProcess.outputs]) {
        // A parent process's own edge always has the process as one endpoint.
        // Skip malformed edges where neither endpoint is a process.
        if (edge.from.kind !== 'proc' && edge.to.kind !== 'proc') continue;
        const outsideEp = edge.from.kind === 'proc' ? edge.to : edge.from;
        if (outsideEp.kind !== 'db') continue; // only db: carries column semantics
        const key = outsideEp.name;
        if (!parentColsByEndpoint.has(key)) parentColsByEndpoint.set(key, new Set());
        for (const col of toColumnList(edge.data)) {
            parentColsByEndpoint.get(key)!.add(col);
        }
    }

    // Compare: any endpoint present in boundary but not parent, or vice versa, fires
    const allKeys = new Set([...boundaryColsByEndpoint.keys(), ...parentColsByEndpoint.keys()]);
    const mismatches: string[] = [];

    for (const key of allKeys) {
        const boundaryCols = boundaryColsByEndpoint.get(key) ?? new Set<string>();
        const parentCols = parentColsByEndpoint.get(key) ?? new Set<string>();

        // Set difference in either direction
        const inBoundaryNotParent = [...boundaryCols].filter(c => !parentCols.has(c));
        const inParentNotBoundary = [...parentCols].filter(c => !boundaryCols.has(c));

        if (inBoundaryNotParent.length > 0 || inParentNotBoundary.length > 0) {
            mismatches.push(
                `endpoint '${key}': boundary=[${[...boundaryCols].sort().join(',')}] parent=[${[...parentCols].sort().join(',')}]`,
            );
        }
    }

    if (mismatches.length === 0) return [];

    return [{
        ruleId: 'flow.unbalanced_decomposition',
        flowId: diagram.id,
        processId: parentProcess.id,
        severity: 'warning',
        message: `Sub-DFD boundary columns for process '${parentProcess.id}' do not match parent inputs/outputs. ${mismatches.join('; ')}`,
    }];
}

// ---------------------------------------------------------------------------
// Build cleaned diagram (strips Class B edges and their store refs)
// ---------------------------------------------------------------------------

function buildCleanedDiagram(
    diagram: FlowDiagram,
    strippedEdgeIds: Set<number>,
    cleanedSubDfds: FlowDiagram[],
): FlowDiagram {
    const activeEdges = diagram.edges.filter((_, idx) => !strippedEdgeIds.has(idx));

    // Rebuild store refs from surviving edges only
    const seenStores = new Map<string, FlowStoreRef>();
    for (const edge of activeEdges) {
        for (const ep of [edge.from, edge.to]) {
            if (!isStoreKind(ep.kind)) continue;
            const key = `${ep.kind}:${ep.name}`;
            if (seenStores.has(key)) continue;
            // Carry over body + displayName from original storeRefs if present
            const original = diagram.storeRefs.find(s => s.kind === ep.kind && s.name === ep.name);
            seenStores.set(key, original ?? { kind: ep.kind, name: ep.name, displayName: ep.name, flowId: diagram.id });
        }
    }

    return {
        ...diagram,
        edges: activeEdges,
        storeRefs: Array.from(seenStores.values()),
        subDfds: cleanedSubDfds,
    };
}

// ---------------------------------------------------------------------------
// validateDiagram — validates a single FlowDiagram recursively
// ---------------------------------------------------------------------------

function validateDiagram(
    diagram: FlowDiagram,
    entityModel: Model,
    config: FlowRulesConfig,
    allErrors: FlowError[],
): FlowDiagram {
    // Phase 1: Class B checks — build the stripped edge set
    const { errors: storeErrors, strippedEdgeIds: stripped1 } =
        checkUnknownStore(diagram, entityModel);
    allErrors.push(...storeErrors);

    const { errors: extErrors, newStripped: stripped2 } =
        checkUnknownExternal(diagram, stripped1);
    allErrors.push(...extErrors);

    const { errors: procErrors, newStripped: stripped3 } =
        checkUnknownProcess(diagram, stripped2);
    allErrors.push(...procErrors);

    const { errors: illegalErrors, newStripped: stripped4 } =
        checkIllegalConnection(diagram, stripped3);
    allErrors.push(...illegalErrors);

    // Active (surviving) edges after all Class B stripping
    const activeEdges = diagram.edges.filter((_, idx) => !stripped4.has(idx));

    // Phase 2: Class A checks on active edges
    allErrors.push(...checkUnknownAttributes(diagram, entityModel, activeEdges));
    allErrors.push(...checkAmbiguousEndpoints(diagram, activeEdges));
    allErrors.push(...checkProcessToProcess(diagram, activeEdges, config));
    allErrors.push(...checkProcessIsolation(diagram, activeEdges));
    allErrors.push(...checkDuplicateNumbers(diagram));

    // Phase 3: decomposition check at every seam
    const cleanedSubDfds: FlowDiagram[] = [];
    for (const subDfd of diagram.subDfds) {
        // Find the parent process for this sub-DFD
        const parentProcess = diagram.processes.find(p => p.id === subDfd.id);
        if (parentProcess) {
            allErrors.push(...checkUnbalancedDecomposition(diagram, parentProcess, subDfd));
        }
        // Recurse
        const cleanedSub = validateDiagram(subDfd, entityModel, config, allErrors);
        cleanedSubDfds.push(cleanedSub);
    }

    return buildCleanedDiagram(diagram, stripped4, cleanedSubDfds);
}

// ---------------------------------------------------------------------------
// validateFlows — top-level export
// ---------------------------------------------------------------------------

export function validateFlows(
    flowModel: FlowModel,
    entityModel: Model,
    config: FlowRulesConfig = {},
): FlowValidationResult {
    const allErrors: FlowError[] = [];
    const cleanedDiagrams: FlowDiagram[] = [];

    for (const diagram of flowModel.diagrams) {
        const cleaned = validateDiagram(diagram, entityModel, config, allErrors);
        cleanedDiagrams.push(cleaned);
    }

    return {
        flowErrors: allErrors,
        globalErrors: [],
        cleanedFlowModel: {
            ...flowModel,
            diagrams: cleanedDiagrams,
        },
    };
}
