/**
 * flow-derive-levels.ts — CP4 level derivation.
 *
 * Takes a parsed FlowModel (flat diagrams = the activity leaves) and returns a
 * new FlowModel whose diagrams is the leveled tree:
 *
 *   diagrams[0] = context (Level 0)
 *     subDfds[0] = L1 overview
 *       subDfds[0..N-1] = renumbered leaf diagrams
 *
 * Pure module — no Bun/Node I/O. Reuses the existing FlowDiagram shape; no new
 * types introduced. Downstream consumers (/api/flow, buildFlowDocResolver,
 * buildFlowNodeUsageIndex, buildEntityUsageIndex, FlowsView drill machinery)
 * are unaffected: the tree structure is unchanged.
 *
 * Convention (drill-down): FlowsView finds a subDfd by
 *   currentDiagram.subDfds.find(d => d.id === processId)
 * Therefore every process's `id` must equal the `id` of its corresponding subDfd.
 */

import type {
    FlowDiagram,
    FlowEdge,
    FlowEndpoint,
    FlowExternal,
    FlowModel,
    FlowProcess,
    FlowStoreRef,
} from './flow-parse';
import { titlelize } from './titlelize';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Narrows a FlowEndpoint kind to the subset that can appear in a FlowStoreRef. */
function isStoreKind(k: FlowEndpoint['kind']): k is FlowStoreRef['kind'] {
    return k !== 'proc' && k !== 'ext';
}

/** Collect all unique externals from a set of leaf diagrams (dedup by id). */
function collectExternals(leaves: FlowDiagram[]): FlowExternal[] {
    const seen = new Map<string, FlowExternal>();
    for (const leaf of leaves) {
        for (const ext of leaf.externals) {
            if (!seen.has(ext.id)) seen.set(ext.id, ext);
        }
    }
    return Array.from(seen.values());
}

/**
 * For a given leaf diagram, count how many distinct leaf diagrams reference a
 * given store token (kind:name). Returns a map of token → Set<leafId>.
 */
function buildStoreDegreeMap(leaves: FlowDiagram[]): Map<string, Set<string>> {
    const tokenToDiagrams = new Map<string, Set<string>>();
    for (const leaf of leaves) {
        for (const ref of leaf.storeRefs) {
            const token = `${ref.kind}:${ref.name}`;
            let diagSet = tokenToDiagrams.get(token);
            if (diagSet === undefined) {
                diagSet = new Set();
                tokenToDiagrams.set(token, diagSet);
            }
            diagSet.add(leaf.id);
        }
    }
    return tokenToDiagrams;
}

/**
 * Collect the promoted (degree ≥ 2) store refs from all leaves, deduped.
 * When the same token appears in multiple leaves, keep the first definition
 * (preserves displayName / body from whichever leaf had it first).
 */
function collectPromotedStores(
    leaves: FlowDiagram[],
    degreeMap: Map<string, Set<string>>,
): FlowStoreRef[] {
    const promoted = new Map<string, FlowStoreRef>();
    for (const leaf of leaves) {
        for (const ref of leaf.storeRefs) {
            const token = `${ref.kind}:${ref.name}`;
            if (promoted.has(token)) continue;
            const degree = degreeMap.get(token)?.size ?? 0;
            if (degree >= 2) promoted.set(token, ref);
        }
    }
    return Array.from(promoted.values());
}

/**
 * Build a fresh FlowEndpoint.
 * The `raw` field mirrors what parsers produce for qualified kind:name tokens.
 */
function ep(kind: FlowEndpoint['kind'], name: string): FlowEndpoint {
    return { kind, name, raw: `${kind}:${name}` };
}

/**
 * Renumber a leaf diagram and its entire subDfd subtree with the dotted prefix N.
 *
 * The parser threads the full ancestor chain into every process's dottedNumber
 * (e.g. VerifyToken inside Login inside Authenticate gets "1.1.1" relative to
 * the leaf root). `renumberDiagram` prefixes `N.` to that full relative number,
 * producing the correct absolute dotted number at any nesting depth.
 *
 * Renumbering rule: each process's dottedNumber becomes `${parentN}.${dottedNumber}`.
 * Fallback: if the existing dottedNumber has no numeric component (shouldn't happen —
 * the parser always composes a numeric dotted path — but guards against empty/NaN),
 * folder-order position (1-indexed) is used as the local suffix instead.
 *
 * Returns new diagram objects (shallow copies); the input is never mutated.
 */
function renumberDiagram(diagram: FlowDiagram, parentN: number): FlowDiagram {
    const renumberedProcesses = diagram.processes.map((proc, idx) => {
        // Use the full relative dottedNumber from the parser as-is, unless it
        // is empty or non-numeric — in which case fall back to folder-order.
        const isNumericDotted = proc.dottedNumber.length > 0
            && proc.dottedNumber.split('.').every(seg => /^\d+$/.test(seg));
        const localPath = isNumericDotted ? proc.dottedNumber : String(idx + 1);
        return { ...proc, dottedNumber: `${parentN}.${localPath}` };
    });
    const renumberedSubDfds = diagram.subDfds.map(sub => renumberDiagram(sub, parentN));
    return { ...diagram, processes: renumberedProcesses, subDfds: renumberedSubDfds };
}

/** Alias used by deriveL1 — renumbers the top-level leaf and its whole subDfd tree. */
function renumberLeaf(leaf: FlowDiagram, parentN: number): FlowDiagram {
    return renumberDiagram(leaf, parentN);
}

// ---------------------------------------------------------------------------
// Context diagram (Level 0)
// ---------------------------------------------------------------------------

/**
 * Derive the context (Level-0) diagram from the leaf set.
 *
 * One process = the whole system (id = systemId).
 * Externals = union of all externals across leaves.
 * Edges = all external↔process boundary flows aggregated to ext↔systemProcess.
 * No stores.
 * subDfds = [l1Diagram] (drill target).
 */
function deriveContext(
    leaves: FlowDiagram[],
    systemId: string,
    systemLabel: string,
    allExternals: FlowExternal[],
    l1Diagram: FlowDiagram,
    contextId: string,
): FlowDiagram {
    const systemProc = ep('proc', systemId);
    const seenEdgeKeys = new Set<string>();
    const edges: FlowEdge[] = [];

    for (const leaf of leaves) {
        // Only include externals that are declared in this leaf's _externals/ directory.
        // Undeclared externals (bare ext: references without a description file) are
        // unknowns that the validator will flag — do not promote them to context level.
        const knownLeafExtIds = new Set(leaf.externals.map(e => e.id));

        for (const edge of leaf.edges) {
            const fromExt = edge.from.kind === 'ext';
            const toExt = edge.to.kind === 'ext';
            if (!fromExt && !toExt) continue; // skip internal edges

            // Skip edges to/from undeclared externals
            if (fromExt && !knownLeafExtIds.has(edge.from.name)) continue;
            if (toExt && !knownLeafExtIds.has(edge.to.name)) continue;

            // Aggregate to system process — keep the external endpoint, replace any
            // process endpoint with the system process.
            let fromEp: FlowEndpoint;
            let toEp: FlowEndpoint;

            if (fromExt && !toExt) {
                fromEp = edge.from;
                toEp = systemProc;
            } else if (toExt && !fromExt) {
                fromEp = systemProc;
                toEp = edge.to;
            } else {
                // Both endpoints are ext (rare: external → external, skipped by validator)
                continue;
            }

            // Dedup: one edge per (extId, direction)
            const key = `${fromEp.kind}:${fromEp.name}→${toEp.kind}:${toEp.name}`;
            if (seenEdgeKeys.has(key)) continue;
            seenEdgeKeys.add(key);

            edges.push({ from: fromEp, to: toEp, data: '', flowId: contextId });
        }
    }

    const systemProcess: FlowProcess = {
        id: systemId,
        label: systemLabel,
        dottedNumber: '0',
        inputs: edges.filter(e => e.to.kind === 'proc'),
        outputs: edges.filter(e => e.from.kind === 'proc'),
        body: '',
        bodyHtml: '',
        hasSubDfd: true,
        flowId: contextId,
    };

    return {
        id: contextId,
        title: titlelize(contextId),
        processes: [systemProcess],
        externals: allExternals,
        storeRefs: [],
        edges,
        subDfds: [l1Diagram],
    };
}

// ---------------------------------------------------------------------------
// L1 overview diagram
// ---------------------------------------------------------------------------

/**
 * Derive the Level-1 overview diagram from the leaf set.
 *
 * One process per leaf diagram (id = leaf.id, dottedNumber = '1'…'N').
 * Stores = promoted (degree ≥ 2) stores.
 * Edges = promoted-store ↔ activity-process, deduped per (storeToken, procId, direction).
 * Externals = union of all externals (same as context).
 * subDfds = renumbered leaf diagrams.
 */
function deriveL1(
    leaves: FlowDiagram[],
    systemId: string,
    allExternals: FlowExternal[],
    promotedStores: FlowStoreRef[],
    promotedStoreTokens: Set<string>,
): FlowDiagram {
    const processes: FlowProcess[] = [];
    const renumberedLeaves: FlowDiagram[] = [];
    const edges: FlowEdge[] = [];

    const seenEdgeKeys = new Set<string>();

    for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i]!;
        const n = i + 1;
        const dottedNumber = String(n);

        // Build the L1 process for this activity
        const l1Process: FlowProcess = {
            id: leaf.id,
            label: leaf.title,
            number: n,
            dottedNumber,
            inputs: [],
            outputs: [],
            body: '',
            bodyHtml: '',
            hasSubDfd: true,
            flowId: systemId,
        };

        // Collect promoted-store edges for this leaf (activity ↔ promoted store)
        const procEp = ep('proc', leaf.id);
        for (const edge of leaf.edges) {
            const fromIsProc = edge.from.kind === 'proc';
            const toIsProc = edge.to.kind === 'proc';

            // We want store ↔ proc edges where the store is promoted
            let storeEp: FlowEndpoint | null = null;
            let direction: 'store-to-proc' | 'proc-to-store' | null = null;

            if (fromIsProc) {
                const toToken = `${edge.to.kind}:${edge.to.name}`;
                if (promotedStoreTokens.has(toToken)) {
                    storeEp = edge.to;
                    direction = 'proc-to-store';
                }
            } else if (toIsProc) {
                const fromToken = `${edge.from.kind}:${edge.from.name}`;
                if (promotedStoreTokens.has(fromToken)) {
                    storeEp = edge.from;
                    direction = 'store-to-proc';
                }
            }

            if (storeEp === null || direction === null) continue;

            // Dedup at L1: one edge per (procId, storeToken, direction)
            const storeToken = `${storeEp.kind}:${storeEp.name}`;
            const key = `${leaf.id}|${storeToken}|${direction}`;
            if (seenEdgeKeys.has(key)) continue;
            seenEdgeKeys.add(key);

            if (!isStoreKind(storeEp.kind)) continue; // guard: should not reach here (promotedStoreTokens excludes proc/ext)
            const storeRef = ep(storeEp.kind, storeEp.name);

            if (direction === 'proc-to-store') {
                edges.push({ from: procEp, to: storeRef, data: '', flowId: systemId });
            } else {
                edges.push({ from: storeRef, to: procEp, data: '', flowId: systemId });
            }
        }

        // Also add ext↔proc boundary edges at L1
        const seenExtKeys = new Set<string>();
        for (const edge of leaf.edges) {
            const fromExt = edge.from.kind === 'ext';
            const toExt = edge.to.kind === 'ext';
            if (!fromExt && !toExt) continue;

            let fromEp: FlowEndpoint;
            let toEp: FlowEndpoint;

            if (fromExt) {
                fromEp = edge.from;
                toEp = procEp;
            } else {
                fromEp = procEp;
                toEp = edge.to;
            }

            const extKey = `${leaf.id}|${fromEp.kind}:${fromEp.name}→${toEp.kind}:${toEp.name}`;
            if (seenExtKeys.has(extKey)) continue;
            seenExtKeys.add(extKey);

            const dedupeKey = `${fromEp.kind}:${fromEp.name}→${toEp.kind}:${toEp.name}`;
            if (seenEdgeKeys.has(dedupeKey)) continue;
            seenEdgeKeys.add(dedupeKey);

            edges.push({ from: fromEp, to: toEp, data: '', flowId: systemId });
        }

        // Update L1 process inputs/outputs from collected edges
        l1Process.inputs = edges.filter(e =>
            e.to.kind === 'proc' && e.to.name === leaf.id,
        );
        l1Process.outputs = edges.filter(e =>
            e.from.kind === 'proc' && e.from.name === leaf.id,
        );

        processes.push(l1Process);
        renumberedLeaves.push(renumberLeaf(leaf, n));
    }

    return {
        id: systemId,
        title: titlelize(systemId),
        processes,
        externals: allExternals,
        storeRefs: promotedStores,
        edges,
        subDfds: renumberedLeaves,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identifier used for the context diagram and the system process / L1 diagram.
 * Stable — must not change across runs (it appears in URL hash `dfd=` param).
 *
 * Exported so that flow-validate.ts can skip balancing checks at the synthetic
 * seams (context↔L1 and L1↔leaf), which carry no column data by design.
 * Balancing at the new levels is CP5 work, not CP4.
 */
export const CONTEXT_DIAGRAM_ID = '__context__';
export const SYSTEM_PROCESS_ID = '__system__';
/**
 * Set of synthetic diagram ids injected by deriveLevels() — the context (Level 0)
 * and the L1 overview (whose id equals SYSTEM_PROCESS_ID). Consumers that build
 * document surfaces from the leveled tree (e.g. DictionaryView) skip these so only
 * user-authored leaf diagrams are surfaced.
 */
export const SYNTHETIC_DIAGRAM_IDS: ReadonlySet<string> = new Set([
    CONTEXT_DIAGRAM_ID,
    SYSTEM_PROCESS_ID,
]);
const SYSTEM_LABEL = 'System';

/**
 * Take a FlowModel whose `diagrams` are the parsed leaf activity diagrams and
 * return a new FlowModel with the fully leveled tree:
 *
 *   diagrams[0] = context (Level 0)
 *     └─ subDfds[0] = L1 overview (id = SYSTEM_PROCESS_ID)
 *          ├─ subDfds[0] = renumbered leaf 1
 *          ├─ subDfds[1] = renumbered leaf 2
 *          ...
 *          └─ subDfds[N-1] = renumbered leaf N
 *
 * The leaf diagrams are the activity-level DFDs exactly as `parseFlows` produced
 * them (their own sub-DFDs, if any, are preserved unchanged — this function only
 * wraps the top-level, it does not alter deeper nesting).
 *
 * When `diagrams` is empty, returns the model unchanged (nothing to derive).
 *
 * Pure: no I/O, no mutations of the input.
 */
export function deriveLevels(flowModel: FlowModel): FlowModel {
    const leaves = flowModel.diagrams;
    if (leaves.length === 0) return flowModel;

    const degreeMap = buildStoreDegreeMap(leaves);
    const promotedStores = collectPromotedStores(leaves, degreeMap);
    const promotedStoreTokens = new Set(promotedStores.map(s => `${s.kind}:${s.name}`));
    const allExternals = collectExternals(leaves);

    // Derive L1 first (needed as subDfd of context)
    const l1Diagram = deriveL1(
        leaves,
        SYSTEM_PROCESS_ID,
        allExternals,
        promotedStores,
        promotedStoreTokens,
    );

    const contextDiagram = deriveContext(
        leaves,
        SYSTEM_PROCESS_ID,
        SYSTEM_LABEL,
        allExternals,
        l1Diagram,
        CONTEXT_DIAGRAM_ID,
    );

    return { ...flowModel, diagrams: [contextDiagram] };
}
