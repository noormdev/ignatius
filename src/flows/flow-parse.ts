/**
 * flow-parse.ts — SSADM data flow diagram parser.
 *
 * Discovers flows/*\/  under modelDir; reads process files (*.md with process:
 * frontmatter), _externals/*.md, optional _stores/*.md; builds FlowModel
 * with recursive sub-DFDs (a process file paired with a same-named folder)
 * and composed dotted SSADM numbers.
 *
 * No Node I/O beyond Bun.file / Bun.Glob. Output is FlowParseResult.
 * Not bundled into the React bundle — only called from cli.ts and server.ts.
 */

import { parse as parseYaml } from 'yaml';
import MarkdownIt from 'markdown-it';
import type { GlobalError } from '../model/validate';
import { wikiLinkPlugin } from '../model/wikilink';
import { titlelize } from './titlelize';

const md = new MarkdownIt();
// `[[Target]]` links in flow markdown (process / external / store bodies) render
// as `a.entity-link[data-entity]` anchors, same as ERD entity bodies. Rendered
// optimistically (no knownIds) — every target becomes a navigable anchor and the
// flow viewer resolves it at click time across flow nodes + ERD entities.
md.use(wikiLinkPlugin);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowEndpoint = {
    kind: 'ext' | 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual' | 'other' | 'proc';
    name: string;
    raw: string;
};

export type FlowData = string | string[];

export type FlowEdge = {
    from: FlowEndpoint;
    to: FlowEndpoint;
    data: FlowData;
    flowId: string;
};

/** One row in a process example table. Values are plain scalars. */
export type FlowExampleRow = Record<string, string | number | boolean>;

/** One annotated data flow in a process `examples:` block (in or out direction). */
export type FlowExample = {
    /** Source token for in-flows (e.g. `ext:Customer`). */
    from?: string;
    /** Destination token for out-flows (e.g. `db:Payment`). */
    to?: string;
    /** Human label for the flow (mirrors the process `inputs/outputs` `data` label). */
    label?: string;
    /** Sample rows to display as a table. */
    rows: FlowExampleRow[];
};

export type FlowProcess = {
    id: string;
    label: string;
    number?: number;
    dottedNumber: string;
    inputs: FlowEdge[];
    outputs: FlowEdge[];
    body: string;
    bodyHtml: string;
    hasSubDfd: boolean;
    flowId: string;
    /** Optional in/out data examples for rendering as tables in the process dialog. */
    examples?: { in: FlowExample[]; out: FlowExample[] };
};

export type FlowExternal = {
    id: string;
    label: string;
    /** Optional kind from `kind:` frontmatter. Absent → conventional green external color. */
    kind?: FlowStoreRef['kind'];
    body: string;
    bodyHtml: string;
    flowId: string;
};

export type FlowStoreRef = {
    kind: 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual' | 'other';
    /** Slug / identifier — used as the identity key (e.g. from `cache:orders-cache`). */
    name: string;
    /** Human-readable display label. Resolved as: title: frontmatter → titlelize(name).
     *  Falls back to `name` when no _stores/*.md description is present. */
    displayName: string;
    body?: string;
    bodyHtml?: string;
    flowId: string;
};

export type FlowDiagram = {
    id: string;
    /** Human-readable display title. Derived from titlelize(id) at parse time.
     *  Always use this for display; keep `id` for routing/lookup. */
    title: string;
    processes: FlowProcess[];
    externals: FlowExternal[];
    storeRefs: FlowStoreRef[];
    edges: FlowEdge[];
    subDfds: FlowDiagram[];
};

export type FlowModel = {
    diagrams: FlowDiagram[];
    modelDir: string;
};

export type FlowParseResult = {
    flowModel: FlowModel;
    globalErrors: GlobalError[];
};

// Used internally during resolution; full resolution lives in CP-3.
type EndpointContext = {
    externals: Set<string>;
    storeRefs: Map<string, FlowStoreRef>;
    processes: Set<string>;
};

// ---------------------------------------------------------------------------
// Endpoint string parsing
// ---------------------------------------------------------------------------

const VALID_KINDS_LIST: readonly string[] = ['ext', 'db', 'cache', 'queue', 'file', 'doc', 'manual', 'other', 'proc'];
const VALID_KINDS = new Set<string>(VALID_KINDS_LIST);

function isFlowKind(s: string): s is FlowEndpoint['kind'] {
    return VALID_KINDS.has(s);
}

// Known kinds that may appear in _stores/*.md frontmatter (excludes 'db' and 'proc').
type KnownStoreKind = Exclude<FlowStoreRef['kind'], 'db'>;
const KNOWN_STORE_KIND_SET = new Set<string>(['cache', 'queue', 'file', 'doc', 'manual', 'other']);

function isKnownStoreKind(v: unknown): v is KnownStoreKind {
    return typeof v === 'string' && KNOWN_STORE_KIND_SET.has(v);
}

function parseKind(raw: string): FlowEndpoint['kind'] | null {
    const colon = raw.indexOf(':');
    if (colon === -1) return null;
    const prefix = raw.slice(0, colon);
    if (isFlowKind(prefix)) return prefix;
    return null;
}

/**
 * Parse a raw endpoint string into a FlowEndpoint.
 *
 * Qualified (kind:name) → parse directly.
 * Bare name (no prefix) → set kind 'proc' provisionally (full resolution in CP-3).
 */
function parseEndpoint(raw: string): FlowEndpoint {
    const colon = raw.indexOf(':');
    if (colon !== -1) {
        const prefix = raw.slice(0, colon);
        if (isFlowKind(prefix)) {
            return {
                kind: prefix,
                name: raw.slice(colon + 1).trim(),
                raw,
            };
        }
    }
    // Bare name — provisional kind 'proc' (CP-3 does full resolution + ambiguity)
    return { kind: 'proc', name: raw.trim(), raw };
}

// ---------------------------------------------------------------------------
// Exported stub for CP-3 endpoint resolution
// ---------------------------------------------------------------------------

export type EndpointContextPublic = {
    externals: Set<string>;
    storeKindByName: Map<string, FlowEndpoint['kind']>;
    processes: Set<string>;
};

/**
 * resolveEndpoint — pure; splits on ':' prefix to determine kind.
 *
 * Qualified (kind:Name) → resolves directly without ambiguity check.
 * Returns null only when the qualified kind is unknown (shouldn't happen
 * if parseEndpoint ran first, but defensive).
 *
 * Bare (no prefix) → checks uniqueness across three namespaces:
 *   - externals (ext:Name)
 *   - storeRefs by name (any non-db/non-proc kind)
 *   - processes (proc:Name)
 * Unique match → resolves with that kind.
 * Zero matches → null (caller emits flow.unknown_process or similar).
 * Multiple matches (collision) → null (caller emits flow.ambiguous_endpoint).
 *
 * Comparison is against the resolved `kind:name` form so spelling variants
 * that yield the same pair are treated identically.
 */
export function resolveEndpoint(
    raw: string,
    context: EndpointContextPublic,
): FlowEndpoint | null {
    const trimmed = raw.trim();
    const kind = parseKind(trimmed);

    // Qualified — resolve directly.
    if (kind !== null) {
        const colon = trimmed.indexOf(':');
        const name = trimmed.slice(colon + 1).trim();
        return { kind, name, raw };
    }

    // Bare name — search all three namespaces for a unique match.
    const name = trimmed;
    const matches: FlowEndpoint[] = [];

    if (context.externals.has(name)) {
        matches.push({ kind: 'ext', name, raw });
    }

    // Check store namespaces: storeKindByName maps name → kind (non-db, non-proc)
    const storeKind = context.storeKindByName.get(name);
    if (storeKind !== undefined) {
        matches.push({ kind: storeKind, name, raw });
    }

    if (context.processes.has(name)) {
        matches.push({ kind: 'proc', name, raw });
    }

    if (matches.length === 1) {
        return matches[0]!;
    }

    // Zero matches or collision → null (caller emits appropriate rule)
    return null;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a process `examples:` frontmatter value into a typed structure.
 * Defensive: missing/malformed entries produce empty arrays rather than errors.
 * Returns undefined when the value is absent (no `examples` field in frontmatter).
 */
export function parseProcessExamples(
    raw: unknown,
): { in: FlowExample[]; out: FlowExample[] } | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!isRecord(raw)) return undefined;

    function parseExampleList(list: unknown): FlowExample[] {
        if (!Array.isArray(list)) return [];
        const result: FlowExample[] = [];
        for (const item of list) {
            if (!isRecord(item)) continue;
            const from = typeof item['from'] === 'string' ? item['from'] : undefined;
            const to = typeof item['to'] === 'string' ? item['to'] : undefined;
            const label = typeof item['label'] === 'string' ? item['label'] : undefined;
            const rows = parseExampleRows(item['rows']);
            result.push({ ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(label !== undefined ? { label } : {}), rows });
        }
        return result;
    }

    function parseExampleRows(rowsRaw: unknown): FlowExampleRow[] {
        if (!Array.isArray(rowsRaw)) return [];
        const result: FlowExampleRow[] = [];
        for (const row of rowsRaw) {
            if (!isRecord(row)) continue;
            const typed: FlowExampleRow = {};
            for (const [k, v] of Object.entries(row)) {
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                    typed[k] = v;
                }
            }
            result.push(typed);
        }
        return result;
    }

    return {
        in: parseExampleList(raw['in']),
        out: parseExampleList(raw['out']),
    };
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) throw new Error('No YAML frontmatter found');
    const parsed: unknown = parseYaml(match[1] ?? '');
    if (!isRecord(parsed)) throw new Error('Frontmatter is not a YAML object');
    return { frontmatter: parsed, body: (match[2] ?? '').trim() };
}

// ---------------------------------------------------------------------------
// Edge building from process inputs/outputs
// ---------------------------------------------------------------------------

type RawEdgeItem = {
    from?: string;
    to?: string;
    data?: FlowData;
};

function buildEdgeFromInput(
    item: RawEdgeItem,
    processId: string,
    flowId: string,
): FlowEdge | null {
    if (typeof item.from !== 'string') return null;
    const from = parseEndpoint(item.from);
    const to: FlowEndpoint = { kind: 'proc', name: processId, raw: `proc:${processId}` };
    const data = item.data ?? '';
    return { from, to, data, flowId };
}

function buildEdgeFromOutput(
    item: RawEdgeItem,
    processId: string,
    flowId: string,
): FlowEdge | null {
    if (typeof item.to !== 'string') return null;
    const from: FlowEndpoint = { kind: 'proc', name: processId, raw: `proc:${processId}` };
    const to = parseEndpoint(item.to);
    const data = item.data ?? '';
    return { from, to, data, flowId };
}

function collectStoreRefsFromEdges(
    edges: FlowEdge[],
    flowId: string,
    storeBodyByKindName: Map<string, { displayName: string; body: string; bodyHtml: string }>,
): FlowStoreRef[] {
    const seen = new Map<string, FlowStoreRef>();
    for (const edge of edges) {
        for (const ep of [edge.from, edge.to]) {
            if (ep.kind === 'proc' || ep.kind === 'ext') continue;
            const key = `${ep.kind}:${ep.name}`;
            if (seen.has(key)) continue;
            const stored = storeBodyByKindName.get(key);
            const ref: FlowStoreRef = {
                kind: ep.kind,
                name: ep.name,
                // Display name: from _stores/ description (with title: override) or titlelize(slug)
                displayName: stored?.displayName ?? titlelize(ep.name),
                flowId,
                ...(stored !== undefined ? { body: stored.body, bodyHtml: stored.bodyHtml } : {}),
            };
            seen.set(key, ref);
        }
    }
    return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// External description loading
// ---------------------------------------------------------------------------

type ExternalDef = { label: string; kind?: FlowStoreRef['kind']; body: string; bodyHtml: string };

/**
 * Read an `_externals/*.md` folder into a map of `extId → {label, body, html}`.
 * Used for both a DFD's own `_externals/` and the shared `flows/_externals/`
 * (so a recurring external like Customer is documented once and reused anywhere,
 * however deeply nested). Missing folder → empty map.
 */
async function readExternalsDir(
    dir: string,
    globalErrors: GlobalError[],
): Promise<Map<string, ExternalDef>> {
    const map = new Map<string, ExternalDef>();
    const glob = new Bun.Glob('*.md');
    try {
        for await (const extPath of glob.scan(dir)) {
            const extFilePath = `${dir}/${extPath}`;
            try {
                const content = await Bun.file(extFilePath).text();
                const { frontmatter, body } = parseFrontmatter(content);
                const externalField = frontmatter['external'];
                if (typeof externalField !== 'string') {
                    globalErrors.push({
                        ruleId: 'parse.missing_id',
                        severity: 'error',
                        omitted: { kind: 'file', id: extFilePath },
                        reason: `External file "${extFilePath}" has no "external" field in frontmatter.`,
                    });
                    continue;
                }
                // Resolve display label: title: (explicit) → external: value → titlelize(id)
                const extId = extPath.replace(/\.md$/, '');
                const extTitleOverride = frontmatter['title'];
                const resolvedExtLabel =
                    typeof extTitleOverride === 'string' && extTitleOverride.trim()
                        ? extTitleOverride.trim()
                        : externalField || titlelize(extId);
                // Optional kind: coloring hint; absent → conventional green external color.
                const extRawKind = frontmatter['kind'];
                const extKind: FlowStoreRef['kind'] | undefined =
                    isKnownStoreKind(extRawKind) ? extRawKind : undefined;
                map.set(extId, { label: resolvedExtLabel, kind: extKind, body, bodyHtml: md.render(body) });
            } catch (err) {
                globalErrors.push({
                    ruleId: 'parse.invalid_yaml',
                    severity: 'error',
                    omitted: { kind: 'file', id: extFilePath },
                    reason: `Cannot parse "${extFilePath}": ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
    } catch {
        // directory does not exist — skip
    }
    return map;
}

// ---------------------------------------------------------------------------
// Parse a single DFD folder (recursive)
// ---------------------------------------------------------------------------

async function parseDiagramFolder(
    diagramId: string,
    folderPath: string,
    parentDottedNumbers: number[],
    visitedPaths: Set<string>,
    rootExternals: Map<string, ExternalDef>,
    globalErrors: GlobalError[],
): Promise<FlowDiagram> {
    // Cycle guard: refuse to re-enter an ancestor folder
    const resolved = folderPath;
    if (visitedPaths.has(resolved)) {
        // Silently return empty diagram rather than looping
        return {
            id: diagramId,
            title: titlelize(diagramId),
            processes: [],
            externals: [],
            storeRefs: [],
            edges: [],
            subDfds: [],
        };
    }
    const nextVisited = new Set(visitedPaths);
    nextVisited.add(resolved);

    const flowId = diagramId;

    // --- Read optional _stores/*.md description files ---
    const storeBodyByKindName = new Map<string, { displayName: string; body: string; bodyHtml: string }>();
    const storesDir = `${folderPath}/_stores`;
    const storeGlob = new Bun.Glob('*.md');
    try {
        for await (const storePath of storeGlob.scan(storesDir)) {
            const storeFilePath = `${storesDir}/${storePath}`;
            try {
                const content = await Bun.file(storeFilePath).text();
                const { frontmatter, body } = parseFrontmatter(content);
                const rawKind = frontmatter['kind'];
                // Accept recognised kinds; anything else (absent / unrecognised) → 'other'.
                const kind: FlowStoreRef['kind'] = isKnownStoreKind(rawKind) ? rawKind : 'other';
                const storeName = storePath.replace(/\.md$/, '');
                const key = `${kind}:${storeName}`;
                // Resolve display name: title: (explicit) → titlelize(slug)
                const storeTitleOverride = frontmatter['title'];
                const resolvedDisplayName =
                    typeof storeTitleOverride === 'string' && storeTitleOverride.trim()
                        ? storeTitleOverride.trim()
                        : titlelize(storeName);
                storeBodyByKindName.set(key, { displayName: resolvedDisplayName, body, bodyHtml: md.render(body) });
            } catch (err) {
                globalErrors.push({
                    ruleId: 'parse.invalid_yaml',
                    severity: 'error',
                    omitted: { kind: 'file', id: storeFilePath },
                    reason: `Cannot parse "${storeFilePath}": ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
    } catch {
        // _stores/ directory does not exist — skip
    }

    // --- Read this DFD's own _externals/*.md (descriptions). Root-level shared
    //     externals are merged in after edges are known (see below). ---
    const localExtMap = await readExternalsDir(`${folderPath}/_externals`, globalErrors);

    // --- Discover process .md files and sub-DFD folders at this level ---
    // List all direct children (non-underscore files and directories)
    const processGlob = new Bun.Glob('*.md');
    const processFiles: string[] = [];
    try {
        for await (const filePath of processGlob.scan(folderPath)) {
            processFiles.push(filePath);
        }
    } catch {
        // folder doesn't exist
    }

    // Sort for stable folder-order fallback numbering
    processFiles.sort();

    const allEdges: FlowEdge[] = [];
    const processes: FlowProcess[] = [];
    const subDfds: FlowDiagram[] = [];

    for (let i = 0; i < processFiles.length; i++) {
        const fileName = processFiles[i]!;
        const filePath = `${folderPath}/${fileName}`;
        const processId = fileName.replace(/\.md$/, '');

        let frontmatter: Record<string, unknown>;
        let body: string;
        try {
            const content = await Bun.file(filePath).text();
            const parsed = parseFrontmatter(content);
            frontmatter = parsed.frontmatter;
            body = parsed.body;
        } catch (err) {
            globalErrors.push({
                ruleId: 'parse.invalid_yaml',
                severity: 'error',
                omitted: { kind: 'file', id: filePath },
                reason: `Cannot parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
        }

        const processLabel = frontmatter['process'];
        if (typeof processLabel !== 'string') {
            // Not a process file (no process: field) — skip silently
            // (could be a README.md or other doc)
            continue;
        }

        // Resolve display label: title: (explicit) → process: value → titlelize(id)
        const titleOverride = frontmatter['title'];
        const resolvedProcessLabel =
            typeof titleOverride === 'string' && titleOverride.trim()
                ? titleOverride.trim()
                : processLabel || titlelize(processId);

        // Local number: authored number: field, else folder-order (1-indexed)
        const rawNumber = frontmatter['number'];
        const localNumber: number | undefined =
            typeof rawNumber === 'number' ? rawNumber : undefined;
        const folderOrderNumber = i + 1;
        const effectiveLocalNumber = localNumber ?? folderOrderNumber;

        // Compose dottedNumber by joining parent path numbers + this local number
        const dottedParts = [...parentDottedNumbers, effectiveLocalNumber];
        const dottedNumber = dottedParts.join('.');

        // Parse inputs / outputs
        const rawInputs = frontmatter['inputs'];
        const rawOutputs = frontmatter['outputs'];

        const inputItems: RawEdgeItem[] = Array.isArray(rawInputs)
            ? rawInputs.filter((x): x is RawEdgeItem => {
                if (isRecord(x)) return true;
                globalErrors.push({
                    ruleId: 'parse.invalid_yaml',
                    severity: 'error',
                    omitted: { kind: 'file', id: filePath },
                    reason: `inputs entry in "${filePath}" is not an object: ${JSON.stringify(x)}`,
                });
                return false;
            })
            : [];
        const outputItems: RawEdgeItem[] = Array.isArray(rawOutputs)
            ? rawOutputs.filter((x): x is RawEdgeItem => {
                if (isRecord(x)) return true;
                globalErrors.push({
                    ruleId: 'parse.invalid_yaml',
                    severity: 'error',
                    omitted: { kind: 'file', id: filePath },
                    reason: `outputs entry in "${filePath}" is not an object: ${JSON.stringify(x)}`,
                });
                return false;
            })
            : [];

        const inputEdges: FlowEdge[] = [];
        const outputEdges: FlowEdge[] = [];

        for (const item of inputItems) {
            const edge = buildEdgeFromInput(item, processId, flowId);
            if (edge) inputEdges.push(edge);
        }
        for (const item of outputItems) {
            const edge = buildEdgeFromOutput(item, processId, flowId);
            if (edge) outputEdges.push(edge);
        }

        allEdges.push(...inputEdges, ...outputEdges);

        // Check for a same-named sub-folder (sub-DFD)
        const subFolderPath = `${folderPath}/${processId}`;
        // Detect sub-DFD: scan for .md files in the same-named folder
        let hasSubDfd = false;
        const subFolderGlob = new Bun.Glob('*.md');
        const subItems: string[] = [];
        try {
            for await (const item of subFolderGlob.scan(subFolderPath)) {
                subItems.push(item);
            }
            hasSubDfd = subItems.length > 0;
        } catch {
            hasSubDfd = false;
        }

        // Parse optional examples: { in: [...], out: [...] } block
        const parsedExamples = parseProcessExamples(frontmatter['examples']);

        processes.push({
            id: processId,
            label: resolvedProcessLabel,
            ...(localNumber !== undefined ? { number: localNumber } : {}),
            dottedNumber,
            inputs: inputEdges,
            outputs: outputEdges,
            body,
            bodyHtml: md.render(body),
            hasSubDfd,
            flowId,
            ...(parsedExamples ? { examples: parsedExamples } : {}),
        });

        // Recurse into sub-DFD if it exists
        if (hasSubDfd) {
            const subDiagram = await parseDiagramFolder(
                processId,
                subFolderPath,
                dottedParts,
                nextVisited,
                rootExternals,
                globalErrors,
            );
            subDfds.push(subDiagram);
        }
    }

    // Externals = this DFD's own definitions + any root-level shared external it
    // actually references. A local definition wins over the root one (override).
    const referencedExt = new Set<string>();
    for (const e of allEdges) {
        if (e.from.kind === 'ext') referencedExt.add(e.from.name);
        if (e.to.kind === 'ext') referencedExt.add(e.to.name);
    }
    const externals: FlowExternal[] = [];
    const includedExt = new Set<string>();
    for (const [extId, def] of localExtMap) {
        externals.push({ id: extId, label: def.label, kind: def.kind, body: def.body, bodyHtml: def.bodyHtml, flowId });
        includedExt.add(extId);
    }
    for (const name of referencedExt) {
        if (includedExt.has(name)) continue;
        const def = rootExternals.get(name);
        if (!def) continue; // not local, not root → flow.unknown_external flags it
        externals.push({ id: name, label: def.label, kind: def.kind, body: def.body, bodyHtml: def.bodyHtml, flowId });
        includedExt.add(name);
    }

    // Build deduplicated store refs from all collected edges
    const storeRefs = collectStoreRefsFromEdges(allEdges, flowId, storeBodyByKindName);

    return {
        id: diagramId,
        title: titlelize(diagramId),
        processes,
        externals,
        storeRefs,
        edges: allEdges,
        subDfds,
    };
}

// ---------------------------------------------------------------------------
// parseFlows — top-level entry
// ---------------------------------------------------------------------------

export async function parseFlows(modelDir: string): Promise<FlowParseResult> {
    const globalErrors: GlobalError[] = [];
    const diagrams: FlowDiagram[] = [];

    const flowsRoot = `${modelDir}/flows`;

    // Discover top-level DFD folders under flows/
    const topLevelGlob = new Bun.Glob('*');
    const diagramFolders: string[] = [];

    try {
        for await (const entry of topLevelGlob.scan({ cwd: flowsRoot, onlyFiles: false })) {
            // Collect all entries; the isDirectory probe below filters to real
            // folders. Skip underscore-prefixed dirs (_externals, _stores) — they
            // are shared-resource folders, not DFDs.
            if (entry.startsWith('_') || entry.startsWith('.')) continue;
            diagramFolders.push(entry);
        }
    } catch {
        // flows/ directory does not exist — return empty model
        return {
            flowModel: { diagrams: [], modelDir },
            globalErrors,
        };
    }

    diagramFolders.sort();

    // Shared externals declared once at flows/_externals/ — usable by any DFD at
    // any depth (passed down the recursion).
    const rootExternals = await readExternalsDir(`${flowsRoot}/_externals`, globalErrors);

    for (const diagramName of diagramFolders) {
        const diagramPath = `${flowsRoot}/${diagramName}`;
        // Verify it is actually a folder by scanning it
        const checkGlob = new Bun.Glob('*');
        let isDirectory = false;
        try {
            // Attempt to iterate; if it errors it's likely a file
            // We only want directories here
            const iter = checkGlob.scan({ cwd: diagramPath, onlyFiles: false });
            await iter.next();
            isDirectory = true; // scan didn't throw
            // Don't drain the iterator — we'll re-scan in parseDiagramFolder
        } catch {
            isDirectory = false;
        }
        if (!isDirectory) continue;

        const diagram = await parseDiagramFolder(
            diagramName,
            diagramPath,
            [],
            new Set<string>([flowsRoot]),
            rootExternals,
            globalErrors,
        );
        diagrams.push(diagram);
    }

    return {
        flowModel: { diagrams, modelDir },
        globalErrors,
    };
}
