import { parse as parseYaml } from 'yaml';
import MarkdownIt from 'markdown-it';
import { defaultTheme, mergeTheme, type ThemeConfig, type ThemePalette, type ThemeSpacing } from './theme-defaults';
import { defaultBranding, mergeBranding, type Branding } from './branding-defaults';

const md = new MarkdownIt();

export type ColumnDef = { type: string; nullable?: boolean; desc?: string; default?: string };

type SubtypeClusterDef = {
  exclusive: boolean;
  desc?: string;
  members: Record<string, Record<string, string>> | string[];
};

type Frontmatter = {
  entity: string;
  // Optional in CP-1 for backward compat; CP-2 will remove hand-authored values.
  // Used only as a legacy Classifier signal — parser derives all other values.
  classification?: string;
  // reference: true marks a classifier/lookup table (preferred over legacy classification: Classifier)
  reference?: boolean;
  group?: string;
  pk: string[];
  columns: Record<string, ColumnDef>;
  ak?: { rule: string; columns: string[] }[];
  subtypes?: SubtypeClusterDef[];
  relationships?: {
    target: string;
    // Optional in CP-1 for backward compat; derived from PK+FK structure.
    identifying?: boolean;
    on: Record<string, string>;
    predicate: string;
  }[];
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
};

export type ModelEdge = {
  source: string;
  target: string;
  identifying: boolean;
  on: Record<string, string>;
  predicate: string;
  cardinality: { parent: Cardinality; child: Cardinality };
};

export type SubtypeCluster = {
  basetype: string;
  exclusive: boolean;
  members: string[];
  desc?: string;
};

export type { ThemeConfig } from './theme-defaults';
export type { Branding } from './branding-defaults';

export type ModelMeta = {
  name?: string;
  version?: string;
  desc?: string;
  updated?: string;
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

export async function parseModels(dir: string): Promise<Model> {
  // Parse optional _theme.yaml and merge with defaults
  const themeFile = Bun.file(`${dir}/_theme.yaml`);
  let theme: ThemeConfig = defaultTheme;
  if (await themeFile.exists()) {
    const raw = parseYaml(await themeFile.text()) as Partial<{
      dark: Partial<ThemePalette>;
      light: Partial<ThemePalette>;
      spacing: Partial<ThemeSpacing>;
    }>;
    theme = mergeTheme(raw ?? {});
  }

  // Parse optional _branding.yaml and merge with defaults
  const brandingFile = Bun.file(`${dir}/_branding.yaml`);
  let branding: Branding = defaultBranding;
  if (await brandingFile.exists()) {
    const raw = parseYaml(await brandingFile.text());
    branding = mergeBranding(raw ?? {});
  }

  const groups: Record<string, GroupConfig> = {};
  const groupsDir = `${dir}/_groups`;
  const groupGlob = new Bun.Glob('*.md');
  for await (const path of groupGlob.scan(groupsDir)) {
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
  // Intermediate: partial node without derived classification; classifier signal from frontmatter
  type RawNode = Omit<ModelNode, 'classification'> & {
    legacyClassification?: string;
    referenceFlag: boolean;
  };
  type RawEdge = {
    source: string;
    target: string;
    on: Record<string, string>;
    predicate: string;
  };

  const rawNodes: RawNode[] = [];
  const rawEdges: RawEdge[] = [];
  const subtypeClusters: SubtypeCluster[] = [];

  for await (const path of glob.scan(dir)) {
    if (path.split('/').some(seg => seg.startsWith('_'))) continue;
    const content = await Bun.file(`${dir}/${path}`).text();
    const { frontmatter, body } = parseFrontmatter(content);

    rawNodes.push({
      id: frontmatter.entity,
      legacyClassification: frontmatter.classification,
      referenceFlag: frontmatter.reference === true,
      group: frontmatter.group,
      pk: frontmatter.pk,
      columns: frontmatter.columns,
      alternateKeys: frontmatter.ak ?? [],
      bodyHtml: md.render(body),
    });

    for (const rel of frontmatter.relationships ?? []) {
      rawEdges.push({
        source: frontmatter.entity,
        target: rel.target,
        on: rel.on,
        predicate: rel.predicate,
      });
    }

    if (frontmatter.subtypes) {
      for (const cluster of frontmatter.subtypes) {
        const members = Array.isArray(cluster.members)
          ? cluster.members
          : Object.keys(cluster.members);
        subtypeClusters.push({
          basetype: frontmatter.entity,
          exclusive: cluster.exclusive,
          members,
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

  // Build final nodes with derived classification
  const nodes: ModelNode[] = rawNodes.map(rawNode => ({
    id: rawNode.id,
    classification: deriveClassification(rawNode),
    group: rawNode.group,
    pk: rawNode.pk,
    columns: rawNode.columns,
    alternateKeys: rawNode.alternateKeys,
    bodyHtml: rawNode.bodyHtml,
  }));

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

  // Parse optional _meta.yaml for display metadata (name, version, desc, updated)
  let _meta: ModelMeta | undefined;
  const metaFile = Bun.file(`${dir}/_meta.yaml`);
  if (await metaFile.exists()) {
    const raw = parseYaml(await metaFile.text()) as ModelMeta;
    _meta = raw;
  }

  return { groups, nodes, edges, subtypeClusters, theme, branding, _meta };
}
