/**
 * flow-clusters.ts — author-cluster registry parse + `cluster:` token expansion.
 *
 * A `clusters/<slug>.md` at the model root declares a named group of entities
 * (`entities:` frontmatter). A process `inputs`/`outputs` entry whose `from`/`to`
 * is `cluster:<slug>` names its `data:` as an entity-id → column-list map;
 * `expandClusterEdges` turns that one entry into one `db:` edge per mapped
 * member, before `parseEndpoint` ever sees the `cluster:` prefix — the closed
 * endpoint-kind set stays untouched.
 *
 * A slug with no matching file, or a map key naming a non-member, is not
 * dropped: the produced edge(s) carry a `clusterIssue` marker instead, naming
 * `flow.unknown_cluster` / `flow.cluster_member_unknown` /
 * `flow.cluster_no_members` for the validator to raise and strip.
 */

import type { GlobalError } from '../model/validate';
import { titlelize } from './titlelize';
import { md, isRecord, parseFrontmatter, normalizedLabel } from './flow-markdown';
import type { FlowData, FlowEdge, FlowEndpoint } from './flow-parse';

export type FlowCluster = {
    slug: string;
    label: string;
    entities: string[];
    body: string;
    bodyHtml: string;
};

/** Coerces a `cluster:` entry's `data:` into an entity-id → columns map,
 *  dropping any key whose value isn't a plain string or string array. */
export function toClusterDataMap(raw: unknown): Record<string, FlowData> {
    const map: Record<string, FlowData> = {};
    if (!isRecord(raw)) return map;
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') {
            map[key] = value;
        } else if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) {
            map[key] = value;
        }
    }
    return map;
}

/**
 * Read `<modelDir>/clusters/*.md` into a slug → FlowCluster lookup.
 * Missing folder → empty map (a model with no `clusters/` folder parses clean).
 */
export async function parseClusters(
    modelDir: string,
    globalErrors: GlobalError[],
    indexFileName: string,
): Promise<Map<string, FlowCluster>> {
    const clusters = new Map<string, FlowCluster>();
    const dir = `${modelDir}/clusters`;
    const glob = new Bun.Glob('*.md');
    try {
        for await (const fileName of glob.scan(dir)) {
            if (fileName === indexFileName) continue;
            const filePath = `${dir}/${fileName}`;
            try {
                const content = await Bun.file(filePath).text();
                const { frontmatter, body } = parseFrontmatter(content);
                const slug = fileName.replace(/\.md$/, '');
                const label = normalizedLabel(frontmatter['label']) ?? titlelize(slug);
                const rawEntities = frontmatter['entities'];
                const entities = Array.isArray(rawEntities)
                    ? rawEntities.filter((e): e is string => typeof e === 'string')
                    : [];
                clusters.set(slug, { slug, label, entities, body, bodyHtml: md.render(body) });
            } catch (err) {
                globalErrors.push({
                    ruleId: 'parse.invalid_yaml',
                    severity: 'error',
                    omitted: { kind: 'file', id: filePath },
                    reason: `Cannot parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
    } catch {
        // clusters/ directory does not exist — skip
    }
    return clusters;
}

/**
 * Expand one `cluster:<slug>` input/output entry into one `db:` edge per
 * mapped member. `otherEnd` is the process endpoint (from: for outputs,
 * to: for inputs); `direction` says which side of the produced edge the
 * process occupies.
 */
export function expandClusterEdges(
    slug: string,
    dataMap: Record<string, FlowData>,
    entryLabel: string | undefined,
    clusters: Map<string, FlowCluster>,
    direction: 'input' | 'output',
    processEndpoint: FlowEndpoint,
    flowId: string,
): FlowEdge[] {
    const cluster = clusters.get(slug);
    const clusterLabel = cluster?.label ?? titlelize(slug);
    const tag = { slug, label: clusterLabel };
    const edgeLabel = normalizedLabel(entryLabel) ?? clusterLabel;

    const members = Object.entries(dataMap);
    if (members.length === 0) {
        // No mapped members — a marker edge carries the trace so
        // flow.cluster_no_members has something to raise and strip.
        const markerEndpoint: FlowEndpoint = { kind: 'db', name: slug, raw: `cluster:${slug}` };
        const edge: FlowEdge = direction === 'input'
            ? { from: markerEndpoint, to: processEndpoint, data: '', flowId, label: edgeLabel, cluster: tag, clusterIssue: 'cluster_no_members' }
            : { from: processEndpoint, to: markerEndpoint, data: '', flowId, label: edgeLabel, cluster: tag, clusterIssue: 'cluster_no_members' };
        return [edge];
    }

    const issue: FlowEdge['clusterIssue'] = cluster === undefined ? 'unknown_cluster' : undefined;

    const edges: FlowEdge[] = [];
    for (const [memberId, data] of members) {
        const memberIssue: FlowEdge['clusterIssue'] = issue
            ?? (cluster && !cluster.entities.includes(memberId) ? 'cluster_member_unknown' : undefined);
        const memberEndpoint: FlowEndpoint = { kind: 'db', name: memberId, raw: `cluster:${slug}#${memberId}` };
        const edge: FlowEdge = direction === 'input'
            ? { from: memberEndpoint, to: processEndpoint, data, flowId, label: edgeLabel, cluster: tag, ...(memberIssue ? { clusterIssue: memberIssue } : {}) }
            : { from: processEndpoint, to: memberEndpoint, data, flowId, label: edgeLabel, cluster: tag, ...(memberIssue ? { clusterIssue: memberIssue } : {}) };
        edges.push(edge);
    }
    return edges;
}
