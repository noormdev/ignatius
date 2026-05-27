import { parse as parseYaml } from 'yaml';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();

type ColumnDef = { type: string; nullable?: boolean; desc?: string; default?: string };

type SubtypeClusterDef = {
  exclusive: boolean;
  desc?: string;
  members: Record<string, Record<string, string>> | string[];
};

type Frontmatter = {
  entity: string;
  classification: string;
  group?: string;
  pk: string[];
  columns: Record<string, ColumnDef>;
  ak?: { rule: string; columns: string[] }[];
  subtypes?: SubtypeClusterDef[];
  relationships?: {
    target: string;
    identifying: boolean;
    on: Record<string, string>;
    predicate: string;
  }[];
};

type GroupConfig = { label: string; color: string };

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

export type Model = {
  groups: Record<string, GroupConfig>;
  nodes: ModelNode[];
  edges: ModelEdge[];
  subtypeClusters: SubtypeCluster[];
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
  const configFile = Bun.file(`${dir}/_config.yaml`);
  const configRaw = await configFile.exists() ? await configFile.text() : '';
  const config = configRaw ? parseYaml(configRaw) as { groups?: Record<string, GroupConfig> } : {};
  const groups = config.groups ?? {};

  const glob = new Bun.Glob('*.md');
  const nodes: ModelNode[] = [];
  const rawEdges: {
    source: string;
    target: string;
    identifying: boolean;
    on: Record<string, string>;
    predicate: string;
  }[] = [];

  const subtypeClusters: SubtypeCluster[] = [];

  for await (const path of glob.scan(dir)) {
    const content = await Bun.file(`${dir}/${path}`).text();
    const { frontmatter, body } = parseFrontmatter(content);

    nodes.push({
      id: frontmatter.entity,
      classification: frontmatter.classification,
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
        identifying: rel.identifying,
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

  // Derive cardinality for each edge
  const nodeMap: Record<string, ModelNode> = {};
  for (const node of nodes) nodeMap[node.id] = node;

  const edges: ModelEdge[] = rawEdges.map(edge => {
    const childNode = nodeMap[edge.source];
    const cardinality = childNode
      ? deriveCardinality(edge, childNode, childNode.alternateKeys)
      : { parent: '1' as Cardinality, child: 'many' as Cardinality };

    return { ...edge, cardinality };
  });

  return { groups, nodes, edges, subtypeClusters };
}
