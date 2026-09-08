/**
 * flow-markdown.ts — frontmatter parsing and the wikilink-enabled markdown
 * renderer shared by flow-parse.ts (processes, externals, stores) and
 * flow-clusters.ts (clusters/*.md), so the two never fork the YAML delimiter
 * regex or the renderer configuration.
 */

import { parse as parseYaml } from 'yaml';
import MarkdownIt from 'markdown-it';
import { wikiLinkPlugin } from '../model/wikilink';
import { highlightCodeFence } from '../model/markdown-highlight';

export const md = new MarkdownIt({ highlight: highlightCodeFence });
// `[[Target]]` links in flow markdown (process / external / store / cluster
// bodies) render as `a.entity-link[data-entity]` anchors, same as ERD entity
// bodies. Rendered optimistically (no knownIds) — every target becomes a
// navigable anchor and the flow viewer resolves it at click time across flow
// nodes + ERD entities.
md.use(wikiLinkPlugin);

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) throw new Error('No YAML frontmatter found');
    const parsed: unknown = parseYaml(match[1] ?? '');
    if (!isRecord(parsed)) throw new Error('Frontmatter is not a YAML object');
    return { frontmatter: parsed, body: (match[2] ?? '').trim() };
}

/** Trims a raw frontmatter value; empty or whitespace-only collapses to
 *  absent so a blank `label: ""` never renders as an authored label. */
export function normalizedLabel(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
