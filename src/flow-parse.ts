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
import type { GlobalError } from './validate';

const md = new MarkdownIt();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowEndpoint = {
    kind: 'ext' | 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual' | 'proc';
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
};

export type FlowExternal = {
    id: string;
    label: string;
    body: string;
    bodyHtml: string;
    flowId: string;
};

export type FlowStoreRef = {
    kind: 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual';
    name: string;
    body?: string;
    bodyHtml?: string;
    flowId: string;
};

export type FlowDiagram = {
    id: string;
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

const VALID_KINDS_LIST: readonly string[] = ['ext', 'db', 'cache', 'queue', 'file', 'doc', 'manual', 'proc'];
const VALID_KINDS = new Set<string>(VALID_KINDS_LIST);

function isFlowKind(s: string): s is FlowEndpoint['kind'] {
    return VALID_KINDS.has(s);
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
    storeBodyByKindName: Map<string, { body: string; bodyHtml: string }>,
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
                flowId,
                ...(stored !== undefined ? { body: stored.body, bodyHtml: stored.bodyHtml } : {}),
            };
            seen.set(key, ref);
        }
    }
    return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Parse a single DFD folder (recursive)
// ---------------------------------------------------------------------------

async function parseDiagramFolder(
    diagramId: string,
    folderPath: string,
    parentDottedNumbers: number[],
    visitedPaths: Set<string>,
    globalErrors: GlobalError[],
): Promise<FlowDiagram> {
    // Cycle guard: refuse to re-enter an ancestor folder
    const resolved = folderPath;
    if (visitedPaths.has(resolved)) {
        // Silently return empty diagram rather than looping
        return {
            id: diagramId,
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
    const storeBodyByKindName = new Map<string, { body: string; bodyHtml: string }>();
    const storesDir = `${folderPath}/_stores`;
    const storeGlob = new Bun.Glob('*.md');
    try {
        for await (const storePath of storeGlob.scan(storesDir)) {
            const storeFilePath = `${storesDir}/${storePath}`;
            try {
                const content = await Bun.file(storeFilePath).text();
                const { frontmatter, body } = parseFrontmatter(content);
                const kind = frontmatter['kind'];
                if (typeof kind !== 'string' || !['cache', 'queue', 'file', 'doc', 'manual'].includes(kind)) continue;
                const storeName = storePath.replace(/\.md$/, '');
                const key = `${kind}:${storeName}`;
                storeBodyByKindName.set(key, { body, bodyHtml: md.render(body) });
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

    // --- Read _externals/*.md ---
    const externals: FlowExternal[] = [];
    const externalsDir = `${folderPath}/_externals`;
    const externalGlob = new Bun.Glob('*.md');
    try {
        for await (const extPath of externalGlob.scan(externalsDir)) {
            const extFilePath = `${externalsDir}/${extPath}`;
            try {
                const content = await Bun.file(extFilePath).text();
                const { frontmatter, body } = parseFrontmatter(content);
                const label = frontmatter['external'];
                if (typeof label !== 'string') {
                    globalErrors.push({
                        ruleId: 'parse.missing_id',
                        severity: 'error',
                        omitted: { kind: 'file', id: extFilePath },
                        reason: `External file "${extFilePath}" has no "external" field in frontmatter.`,
                    });
                    continue;
                }
                const extId = extPath.replace(/\.md$/, '');
                externals.push({
                    id: extId,
                    label,
                    body,
                    bodyHtml: md.render(body),
                    flowId,
                });
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
        // _externals/ directory does not exist — skip
    }

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

        processes.push({
            id: processId,
            label: processLabel,
            ...(localNumber !== undefined ? { number: localNumber } : {}),
            dottedNumber,
            inputs: inputEdges,
            outputs: outputEdges,
            body,
            bodyHtml: md.render(body),
            hasSubDfd,
            flowId,
        });

        // Recurse into sub-DFD if it exists
        if (hasSubDfd) {
            const subDiagram = await parseDiagramFolder(
                processId,
                subFolderPath,
                dottedParts,
                nextVisited,
                globalErrors,
            );
            subDfds.push(subDiagram);
        }
    }

    // Build deduplicated store refs from all collected edges
    const storeRefs = collectStoreRefsFromEdges(allEdges, flowId, storeBodyByKindName);

    return {
        id: diagramId,
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
            // Collect all entries; the isDirectory probe below filters to real folders
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
            globalErrors,
        );
        diagrams.push(diagram);
    }

    return {
        flowModel: { diagrams, modelDir },
        globalErrors,
    };
}
