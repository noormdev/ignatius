import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import MarkdownIt from 'markdown-it';
import { defaultTheme, mergeTheme, type ThemeConfig, type ThemePalette, type ThemeSpacing } from './theme-defaults';
import { defaultBranding, mergeBranding, type Branding } from './branding-defaults';
import { wikiLinkPlugin, type WikiLinkEnv } from './wikilink';
import type { GlobalError } from './validate';

const md = new MarkdownIt();
md.use(wikiLinkPlugin);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export type ColumnDef = { type: string; nullable?: boolean; desc?: string; default?: string };

export type Predicate = { fwd: string; rev: string };

export function normalizePredicate(
  raw: string | { fwd?: string; rev?: string } | null | undefined,
): Predicate {
  if (typeof raw === 'string') return { fwd: raw, rev: raw };
  if (isRecord(raw)) {
    const fwd = typeof raw['fwd'] === 'string' ? raw['fwd'] : '';
    const rev = typeof raw['rev'] === 'string' ? raw['rev'] : '';
    return { fwd, rev };
  }
  return { fwd: '', rev: '' };
}

type SubtypeClusterDef = {
  exclusive: boolean;
  desc?: string;
  members: Record<string, Record<string, string>> | string[];
};

type Frontmatter = {
  // Optional so the per-file try/catch can detect parse.missing_id at runtime.
  entity?: string;
  // Optional in CP-1 for backward compat; CP-2 will remove hand-authored values.
  // Used only as a legacy Classifier signal — parser derives all other values.
  classification?: string;
  // reference: true marks a classifier/lookup table (preferred over legacy classification: Classifier)
  reference?: boolean;
  // singleton: true marks a one-row entity (config/settings); suppresses the missing-pk warning.
  singleton?: boolean;
  group?: string;
  pk?: string[];
  columns?: Record<string, ColumnDef>;
  ak?: { rule: string; columns: string[] }[];
  subtypes?: SubtypeClusterDef[];
  relationships?: {
    target: string;
    // Optional in CP-1 for backward compat; derived from PK+FK structure.
    identifying?: boolean;
    on: Record<string, string>;
    predicate: string | { fwd?: string; rev?: string };
  }[];
  examples?: Record<string, unknown>[];
};

export type GroupConfig = { label: string; color: string; desc?: string; sort_key?: number };

export type Cardinality = '1' | '0..1' | 'many';

export type ModelNode = {
  id: string;
  classification: string;
  group?: string;
  pk: string[];
  columns: Record<string, ColumnDef>;
  alternateKeys: { rule: string; columns: string[] }[];
  bodyHtml: string;
  /** Entity ids referenced via `[[…]]` wiki-links in the body, in source order. */
  bodyLinks?: string[];
  examples?: Record<string, unknown>[];
  /** singleton: true marks a one-row entity (config/settings); suppresses entity.missing_pk. */
  singleton?: boolean;
};

export type ModelEdge = {
  source: string;
  target: string;
  identifying: boolean;
  on: Record<string, string>;
  predicate: Predicate;
  cardinality: { parent: Cardinality; child: Cardinality };
};

export type SubtypeCluster = {
  basetype: string;
  exclusive: boolean;
  members: string[];
  hasDiscriminator: boolean;
  desc?: string;
};

export type { ThemeConfig } from './theme-defaults';
export type { Branding } from './branding-defaults';

export type ModelMeta = {
  name?: string;
  version?: string;
  desc?: string;
  updated?: string;
  /** Loaded from ignatius.yml `flow_rules:` block; passed to validateFlows. */
  flowRules?: import('./flow-validate').FlowRulesConfig;
};

export type Model = {
  groups: Record<string, GroupConfig>;
  nodes: ModelNode[];
  edges: ModelEdge[];
  subtypeClusters: SubtypeCluster[];
  theme: ThemeConfig;
  branding: Branding;
  _meta?: ModelMeta;
};

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('No YAML frontmatter found');
  return {
    frontmatter: parseYaml(match[1]),
    body: match[2].trim(),
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted1 = [...a].sort();
  const sorted2 = [...b].sort();
  return sorted1.every((v, i) => v === sorted2[i]);
}

function deriveCardinality(
  edge: { identifying: boolean; on: Record<string, string> },
  childNode: { pk: string[]; columns: Record<string, ColumnDef>; classification: string },
  childAks: { rule: string; columns: string[] }[],
): { parent: Cardinality; child: Cardinality } {
  const fkChildCols = Object.keys(edge.on);

  if (edge.identifying) {
    if (childNode.classification === 'Subtype') {
      return { parent: '1', child: '0..1' };
    }
    if (arraysEqual(childNode.pk, fkChildCols)) {
      return { parent: '1', child: '1' };
    }
    return { parent: '1', child: 'many' };
  }

  // Referential
  const anyNullable = fkChildCols.some(col => childNode.columns[col]?.nullable);
  const fkFormsAk = childAks.some(ak => arraysEqual(ak.columns, fkChildCols));

  if (anyNullable) {
    return { parent: '0..1', child: fkFormsAk ? '1' : 'many' };
  }
  return { parent: '1', child: fkFormsAk ? '1' : 'many' };
}

export type ParseResult = { model: Model; globalErrors: GlobalError[] };

export async function parseModels(dir: string): Promise<ParseResult> {
  // Parse optional ignatius.yml — single config file for theme, branding, and meta
  let theme: ThemeConfig = defaultTheme;
  let branding: Branding = defaultBranding;
  let _meta: ModelMeta | undefined;

  const configFile = Bun.file(`${dir}/ignatius.yml`);
  if (await configFile.exists()) {
    const parsed: unknown = parseYaml(await configFile.text());
    const raw: Record<string, unknown> = isRecord(parsed) ? parsed : {};
    // Meta lives at top-level keys (name, version, description, updated)
    const { name, version, description, updated, theme: themeRaw, branding: brandingRaw, flow_rules: flowRulesRaw } = raw;
    const metaName = typeof name === 'string' ? name : undefined;
    const metaVersion = typeof version === 'string' ? version : undefined;
    const metaDescription = typeof description === 'string' ? description : undefined;
    const metaUpdated = typeof updated === 'string' ? updated : undefined;
    // Load flow_rules: block into _meta.flowRules
    const flowRules: import('./flow-validate').FlowRulesConfig | undefined =
      isRecord(flowRulesRaw)
        ? {
            ...(typeof flowRulesRaw['process_to_process'] === 'boolean'
              ? { process_to_process: flowRulesRaw['process_to_process'] }
              : {}),
          }
        : undefined;
    // _meta is only populated when at least one meta key is present; remains undefined if all are absent
    if (metaName !== undefined || metaVersion !== undefined || metaDescription !== undefined || metaUpdated !== undefined || flowRules !== undefined) {
      _meta = {
        ...(metaName !== undefined ? { name: metaName } : {}),
        ...(metaVersion !== undefined ? { version: metaVersion } : {}),
        ...(metaDescription !== undefined ? { desc: metaDescription } : {}),
        ...(metaUpdated !== undefined ? { updated: metaUpdated } : {}),
        ...(flowRules !== undefined ? { flowRules } : {}),
      };
    }
    if (themeRaw !== null && typeof themeRaw === 'object') {
      theme = mergeTheme(themeRaw as Partial<{ dark: Partial<ThemePalette>; light: Partial<ThemePalette>; spacing: Partial<ThemeSpacing> }>);
    }
    if (brandingRaw !== null && typeof brandingRaw === 'object') {
      branding = mergeBranding(brandingRaw as Parameters<typeof mergeBranding>[0]);
    }
  }

  const groups: Record<string, GroupConfig> = {};
  const groupsDir = `${dir}/_groups`;
  const groupGlob = new Bun.Glob('*.md');
  if (existsSync(groupsDir)) for await (const path of groupGlob.scan(groupsDir)) {
    const name = path.replace(/\.md$/, '');
    const content = await Bun.file(`${groupsDir}/${path}`).text();
    const { frontmatter, body } = parseFrontmatter(content);
    const fm = frontmatter as unknown as { label: string; color: string; sort_key?: unknown };
    if (fm.sort_key !== undefined && typeof fm.sort_key !== 'number') {
      throw new Error(`Group "${name}": sort_key must be a number, got ${JSON.stringify(fm.sort_key)}`);
    }
    groups[name] = {
      label: fm.label,
      color: fm.color,
      desc: md.render(body),
      ...(fm.sort_key !== undefined ? { sort_key: fm.sort_key } : {}),
    };
  }

  const glob = new Bun.Glob('**/*.md');
  // Intermediate: partial node without derived classification; classifier signal
  // from frontmatter. Holds the raw body — bodyHtml/bodyLinks are rendered in a
  // second pass once every entity id is known (so `[[…]]` links can be resolved
  // against the full set).
  type RawNode = Omit<ModelNode, 'classification' | 'bodyHtml' | 'bodyLinks'> & {
    legacyClassification?: string;
    referenceFlag: boolean;
    body: string;
  };
  type RawEdge = {
    source: string;
    target: string;
    on: Record<string, string>;
    predicate: Predicate;
  };

  const rawNodes: RawNode[] = [];
  const rawEdges: RawEdge[] = [];
  const subtypeClusters: SubtypeCluster[] = [];
  const globalErrors: GlobalError[] = [];

  for await (const path of glob.scan(dir)) {
    if (path.split('/').some(seg => seg.startsWith('_'))) continue;
    // Exclude any file under <modelDir>/flows/ — those are DFD files, not entity files
    if (path.startsWith('flows/')) continue;
    const filePath = `${dir}/${path}`;

    let frontmatter: Frontmatter;
    let body: string;
    try {
      const content = await Bun.file(filePath).text();
      const parsed = parseFrontmatter(content);
      // parseFrontmatter calls parseYaml which may return null for empty fences
      if (parsed.frontmatter === null || parsed.frontmatter === undefined) {
        globalErrors.push({
          ruleId: 'parse.empty_frontmatter',
          severity: 'error',
          omitted: { kind: 'entity', id: filePath },
          reason: `File "${filePath}" has empty YAML frontmatter.`,
        });
        continue;
      }
      frontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch (err) {
      globalErrors.push({
        ruleId: 'parse.invalid_yaml',
        severity: 'error',
        omitted: { kind: 'entity', id: filePath },
        reason: `Cannot parse YAML frontmatter in "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // parse.missing_id: frontmatter parsed but entity field absent or empty
    if (!frontmatter.entity) {
      globalErrors.push({
        ruleId: 'parse.missing_id',
        severity: 'error',
        omitted: { kind: 'entity', id: filePath },
        reason: `File "${filePath}" has no "entity" field in frontmatter.`,
      });
      continue;
    }

    const entityId = frontmatter.entity;

    rawNodes.push({
      id: entityId,
      legacyClassification: frontmatter.classification,
      referenceFlag: frontmatter.reference === true,
      singleton: frontmatter.singleton === true,
      group: frontmatter.group,
      // Default pk to [] and columns to {} when absent
      pk: frontmatter.pk ?? [],
      columns: frontmatter.columns ?? {},
      alternateKeys: frontmatter.ak ?? [],
      body,
      ...(frontmatter.examples !== undefined ? { examples: frontmatter.examples } : {}),
    });

    for (const rel of frontmatter.relationships ?? []) {
      rawEdges.push({
        source: entityId,
        target: rel.target,
        on: rel.on,
        predicate: normalizePredicate(rel.predicate),
      });
    }

    if (frontmatter.subtypes) {
      for (const cluster of frontmatter.subtypes) {
        // Array-form members = no discriminator column; object-form = has discriminator
        const isArrayForm = Array.isArray(cluster.members);
        const members = isArrayForm
          ? (cluster.members as string[])
          : Object.keys(cluster.members as Record<string, unknown>);
        subtypeClusters.push({
          basetype: entityId,
          exclusive: cluster.exclusive,
          members,
          hasDiscriminator: !isArrayForm,
          desc: cluster.desc,
        });
      }
    }
  }

  // Build fast-lookup structures for derivation
  const rawNodeById: Record<string, RawNode> = {};
  for (const node of rawNodes) rawNodeById[node.id] = node;

  // Derive `identifying` per edge: every FK child col in edge.on must be in child PK
  type DerivedEdge = RawEdge & { identifying: boolean };
  const derivedEdges: DerivedEdge[] = rawEdges.map(edge => {
    const childNode = rawNodeById[edge.source];
    if (!childNode) return { ...edge, identifying: false };
    const childPkSet: Record<string, true> = {};
    for (const col of childNode.pk) childPkSet[col] = true;
    const fkCols = Object.keys(edge.on);
    const identifying = fkCols.length > 0 && fkCols.every(col => childPkSet[col] === true);
    return { ...edge, identifying };
  });

  // Build subtype membership set for classification rule 2
  const subtypeMemberSet: Record<string, true> = {};
  for (const cluster of subtypeClusters) {
    for (const member of cluster.members) subtypeMemberSet[member] = true;
  }

  // Build per-node count of distinct identifying parents (for Associative rule)
  const identifyingParentsByChild: Record<string, Set<string>> = {};
  for (const edge of derivedEdges) {
    if (!edge.identifying) continue;
    const parents = identifyingParentsByChild[edge.source] ?? new Set<string>();
    parents.add(edge.target);
    identifyingParentsByChild[edge.source] = parents;
  }

  // Derive `classification` per node — 5-rule order, first match wins
  function deriveClassification(node: RawNode): string {
    // Rule 1: Classifier — reference flag OR legacy classification field
    if (node.referenceFlag || node.legacyClassification === 'Classifier') {
      return 'Classifier';
    }
    // Rule 2: Subtype — appears in any cluster's members
    if (subtypeMemberSet[node.id] === true) {
      return 'Subtype';
    }
    const identifyingParents = identifyingParentsByChild[node.id];
    // Rule 3: Associative — ≥2 distinct identifying parents
    if (identifyingParents && identifyingParents.size >= 2) {
      return 'Associative';
    }
    // Rule 4: Dependent — ≥1 identifying relationship
    if (identifyingParents && identifyingParents.size >= 1) {
      return 'Dependent';
    }
    // Rule 5: Independent
    return 'Independent';
  }

  // Build final nodes with derived classification. Render each body now that the
  // full id set is known, so `[[…]]` links resolve and unknown targets are
  // marked missing + collected for validation.
  const knownIds = new Set(rawNodes.map(n => n.id));
  const nodes: ModelNode[] = rawNodes.map(rawNode => {
    const env: WikiLinkEnv = { knownIds, links: [] };
    const bodyHtml = md.render(rawNode.body, env);
    return {
      id: rawNode.id,
      classification: deriveClassification(rawNode),
      group: rawNode.group,
      pk: rawNode.pk,
      columns: rawNode.columns,
      alternateKeys: rawNode.alternateKeys,
      bodyHtml,
      bodyLinks: env.links,
      ...(rawNode.examples !== undefined ? { examples: rawNode.examples } : {}),
      ...(rawNode.singleton ? { singleton: true } : {}),
    };
  });

  // Derive cardinality for each edge using fully derived node + edge values
  const nodeMap: Record<string, ModelNode> = {};
  for (const node of nodes) nodeMap[node.id] = node;

  const edges: ModelEdge[] = derivedEdges.map(edge => {
    const childNode = nodeMap[edge.source];
    const cardinality = childNode
      ? deriveCardinality(edge, childNode, childNode.alternateKeys)
      : { parent: '1' as Cardinality, child: 'many' as Cardinality };

    return { ...edge, cardinality };
  });

  return {
    model: { groups, nodes, edges, subtypeClusters, theme, branding, _meta },
    globalErrors,
  };
}
