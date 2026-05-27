import { parse as parseYaml, stringify } from 'yaml';
import { resolve } from 'path';

const yamlContent = await Bun.file(resolve(import.meta.dir, '../tmp/sample_model.yaml')).text();
const doc = parseYaml(yamlContent) as Record<string, unknown>;
const outDir = resolve(import.meta.dir, '../models');

type Col = { type: string; nullable?: boolean; default?: unknown; desc?: string };
type Rel = { desc?: string; on: Record<string, string>; predicate: { fwd: string; rev: string } };
type SubtypeCluster = { desc?: string; exclusive: boolean; members: Record<string, Record<string, string>> | string[] };
type AK = { rule: string; desc?: string; columns: string[] };
type Constraint = { rule: string; desc?: string; spans?: string[] };

const groupMapping: Record<string, string> = {};
const entityGroups: Record<string, string[]> = {};

function deriveClassification(name: string, entity: Record<string, unknown>, allEntities: Record<string, Record<string, unknown>>): string {
  const hasSubtypes = !!entity.subtypes;
  const isSubtype = Object.values(allEntities).some(e => {
    const clusters = e.subtypes as SubtypeCluster[] | undefined;
    if (!clusters) return false;
    return clusters.some(c => {
      if (Array.isArray(c.members)) return c.members.includes(name);
      return name in c.members;
    });
  });

  const identifyingRels = entity.relationships && (entity.relationships as Record<string, unknown>).identifying;
  const identifyingCount = identifyingRels ? Object.keys(identifyingRels as Record<string, unknown>).length : 0;

  if (isSubtype) return 'Subtype';
  if (identifyingCount >= 2) return 'Associative';
  if (identifyingCount === 1) return 'Dependent';

  const pk = entity.pk as string[];
  const cols = entity.columns as Record<string, Col>;
  const colNames = Object.keys(cols);
  const hasDescCol = colNames.some(c => ['description', 'desc', 'label', 'name'].includes(c));
  const values = entity.values as Record<string, unknown> | undefined;
  if (pk.length === 1 && identifyingCount === 0 && colNames.length <= 3 && hasDescCol && values) {
    return 'Classifier';
  }

  return 'Independent';
}

type FlatRel = {
  target: string;
  identifying: boolean;
  on: Record<string, string>;
  predicate: string;
};

function flattenRelationships(rels: Record<string, unknown> | undefined): FlatRel[] {
  if (!rels) return [];
  const result: FlatRel[] = [];

  const identifying = rels.identifying as Record<string, Rel> | undefined;
  if (identifying) {
    for (const [target, rel] of Object.entries(identifying)) {
      result.push({
        target,
        identifying: true,
        on: rel.on,
        predicate: rel.predicate.rev,
      });
    }
  }

  const referential = rels.referential as Record<string, Rel> | undefined;
  if (referential) {
    for (const [target, rel] of Object.entries(referential)) {
      result.push({
        target,
        identifying: false,
        on: rel.on,
        predicate: rel.predicate.rev,
      });
    }
  }

  return result;
}

function buildColumnsTable(columns: Record<string, Col>, pk: string[], aks: AK[], rels: FlatRel[]): string {
  const fkTargets: Record<string, string> = {};
  for (const rel of rels) {
    for (const childCol of Object.keys(rel.on)) {
      fkTargets[childCol] = rel.target;
    }
  }

  const rows: string[] = [];
  let i = 1;
  for (const [name, col] of Object.entries(columns)) {
    const roles: string[] = [];
    if (pk.includes(name)) roles.push('PK');
    if (fkTargets[name]) roles.push(`FK → ${fkTargets[name]}`);
    for (const ak of aks) {
      if (ak.columns.includes(name)) roles.push(ak.name);
    }
    const role = roles.length ? roles.join(', ') : '—';
    const nullable = col.nullable ? 'Yes' : 'No';
    const desc = col.desc || (col.default ? `Default: ${col.default}` : '');
    rows.push(`| ${i} | ${name} | ${col.type} | ${role} | ${nullable} | ${desc} |`);
    i++;
  }

  return `| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
${rows.join('\n')}`;
}

function deriveGroup(name: string, entity: Record<string, unknown>, classification: string, allEntities: Record<string, Record<string, unknown>>): string {
  if (classification === 'Classifier') return 'reference';

  const groups = entity.groups as string[] | undefined;
  if (groups) {
    if (groups.some(g => ['payments', 'billing', 'sales'].includes(g))) return 'transactional';
    if (groups.includes('catalog')) return 'catalog';
    if (groups.includes('shared')) return 'reference';
    if (groups.some(g => ['accounts', 'org'].includes(g))) return 'identity';
  }

  // Walk up identifying parents to inherit group
  const rels = entity.relationships as Record<string, unknown> | undefined;
  const identifying = rels?.identifying as Record<string, Rel> | undefined;
  if (identifying) {
    for (const parentName of Object.keys(identifying)) {
      const parent = allEntities[parentName];
      if (parent) {
        return deriveGroup(parentName, parent, '', allEntities);
      }
    }
  }

  return 'identity';
}

const allEntities: Record<string, Record<string, unknown>> = {};
for (const [key, value] of Object.entries(doc)) {
  if (key.startsWith('_')) continue;
  allEntities[key] = value as Record<string, unknown>;
}

for (const [name, entity] of Object.entries(allEntities)) {
  const pk = entity.pk as string[];
  const columns = entity.columns as Record<string, Col>;
  const rels = entity.relationships as Record<string, unknown> | undefined;
  const aks = (entity.ak as AK[]) ?? [];
  const subtypeClusters = entity.subtypes as SubtypeCluster[] | undefined;
  const values = entity.values as Record<string, Record<string, string>> | undefined;
  const constraints = entity.constraints as Constraint[] | undefined;
  const origGroups = entity.groups as string[] | undefined;
  const desc = entity.desc as string | undefined;

  const classification = deriveClassification(name, entity, allEntities);
  const flatRels = flattenRelationships(rels);
  const group = deriveGroup(name, entity, classification, allEntities);

  // Build columns for frontmatter (type + nullable only)
  const fmColumns: Record<string, Record<string, unknown>> = {};
  for (const [colName, col] of Object.entries(columns)) {
    const entry: Record<string, unknown> = { type: col.type };
    if (col.nullable) entry.nullable = true;
    if (col.default) entry.default = String(col.default);
    if (col.desc) entry.desc = col.desc;
    fmColumns[colName] = entry;
  }

  // Build frontmatter
  const fm: Record<string, unknown> = {
    entity: name,
    classification,
    group,
    pk,
    columns: fmColumns,
  };
  if (aks.length) fm.ak = aks.map(a => ({ rule: a.rule, columns: a.columns }));
  if (subtypeClusters) {
    fm.subtypes = subtypeClusters.map(c => {
      const cluster: Record<string, unknown> = { exclusive: c.exclusive };
      if (c.desc) cluster.desc = c.desc;
      if (Array.isArray(c.members)) {
        cluster.members = c.members;
      } else {
        cluster.members = c.members;
      }
      return cluster;
    });
  }
  if (flatRels.length) {
    fm.relationships = flatRels.map(r => {
      const rel: Record<string, unknown> = {
        target: r.target,
        identifying: r.identifying,
        on: r.on,
        predicate: r.predicate,
      };
      return rel;
    });
  }

  // Build body
  const lines: string[] = [];
  lines.push(`# ${name.replace(/_/g, ' ')}`);
  lines.push('');
  if (desc) {
    lines.push(desc);
    lines.push('');
  }

  if (subtypeClusters) {
    lines.push('## Subtypes');
    lines.push('');
    for (const cluster of subtypeClusters) {
      if (cluster.desc) lines.push(cluster.desc);
      lines.push(`- **Exclusive:** ${cluster.exclusive ? 'Yes' : 'No'}`);
      if (Array.isArray(cluster.members)) {
        lines.push(`- **Members:** ${cluster.members.join(', ')}`);
      } else {
        for (const [member, disc] of Object.entries(cluster.members)) {
          const [key, val] = Object.entries(disc)[0];
          lines.push(`- **${member}:** ${key} = ${val}`);
        }
      }
      lines.push('');
    }
  }

  if (values) {
    lines.push('## Values');
    lines.push('');
    for (const [code, val] of Object.entries(values)) {
      lines.push(`- \`${code}\` — ${val.description}`);
    }
    lines.push('');
  }

  if (constraints) {
    lines.push('## Constraints');
    lines.push('');
    for (const c of constraints) {
      lines.push(`- **${c.rule}**: ${c.desc || ''}`);
      if (c.spans) lines.push(`  - Spans: ${c.spans.join(', ')}`);
    }
    lines.push('');
  }

  const fmStr = stringify(fm, { lineWidth: 0 });
  const content = `---\n${fmStr.trim()}\n---\n\n${lines.join('\n').trim()}\n`;
  await Bun.write(`${outDir}/${name}.md`, content);
  console.log(`  wrote ${name}.md`);
}

console.log(`\nDone — ${Object.keys(allEntities).length} entity files written to models/`);
