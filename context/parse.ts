// =============================================================================
// parse.ts — Stage 1: YAML → RawDoc with STRUCTURAL validation only
//
// This pass is intentionally narrow. It accepts/rejects based on shape:
// - required keys present, types match the schema, no unknown top-level keys
// - no semantic checks (those happen in build.ts and validate.ts)
//
// The point is to give the user a clear "your YAML is malformed" error with a
// location, before we waste effort trying to interpret a broken structure.
// =============================================================================

import * as YAML from 'yaml';
import { RawDoc, RawEntity, RawRelationship, RawSubtypeCluster, Issue, LogicalType } from './types';

const VALID_TYPES: LogicalType[] = [
  'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'binary',
];

const ENTITY_BODY_KEYS = new Set([
  'desc', 'groups', 'pk', 'columns', 'ak', 'relationships',
  'subtypes', 'values', 'constraints',
]);

const RELATIONSHIP_KEYS = new Set(['desc', 'on', 'predicate']);

export interface ParseResult {
  doc?: RawDoc;
  issues: Issue[];
}

export function parseStructure(yamlText: string): ParseResult {
  const issues: Issue[] = [];

  let raw: unknown;
  try {
    // Using the `yaml` package (YAML 1.2) — `on` is NOT a reserved boolean here.
    raw = YAML.parse(yamlText);
  } catch (e) {
    issues.push({
      severity: 'error',
      phase: 'parse',
      message: `YAML syntax error: ${(e as Error).message}`,
    });
    return { issues };
  }

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      severity: 'error',
      phase: 'parse',
      message: 'Top-level must be a mapping (object)',
    });
    return { issues };
  }

  const top = raw as Record<string, unknown>;
  const meta = top._meta as RawDoc['meta'] | undefined;
  const groupsRaw = top._groups;
  const groups: Record<string, string> = {};

  // _meta: optional, must be an object of strings/dates if present
  if (meta !== undefined && (typeof meta !== 'object' || meta === null || Array.isArray(meta))) {
    issues.push({
      severity: 'error',
      phase: 'parse',
      message: '_meta must be a mapping',
      location: '_meta',
    });
  }

  // _groups: optional, name -> description (string)
  if (groupsRaw !== undefined) {
    if (typeof groupsRaw !== 'object' || groupsRaw === null || Array.isArray(groupsRaw)) {
      issues.push({
        severity: 'error',
        phase: 'parse',
        message: '_groups must be a mapping of group name to description',
        location: '_groups',
      });
    } else {
      for (const [g, desc] of Object.entries(groupsRaw)) {
        if (typeof desc !== 'string') {
          issues.push({
            severity: 'error',
            phase: 'parse',
            message: `_groups.${g}: description must be a string`,
            location: `_groups.${g}`,
          });
        } else {
          groups[g] = desc;
        }
      }
    }
  }

  const entities: Record<string, RawEntity> = {};

  for (const [name, body] of Object.entries(top)) {
    if (name.startsWith('_')) continue;  // meta-blocks already handled

    const entIssues = validateEntityShape(name, body);
    issues.push(...entIssues);
    if (entIssues.some(i => i.severity === 'error')) continue;

    entities[name] = body as RawEntity;
  }

  if (issues.some(i => i.severity === 'error')) {
    return { issues };
  }

  return {
    doc: { meta, groups, entities },
    issues,
  };
}

function validateEntityShape(name: string, body: unknown): Issue[] {
  const issues: Issue[] = [];
  const loc = name;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    issues.push({ severity: 'error', phase: 'parse', message: 'Entity body must be a mapping', location: loc });
    return issues;
  }

  const b = body as Record<string, unknown>;

  // Unknown top-level keys in entity body
  for (const k of Object.keys(b)) {
    if (!ENTITY_BODY_KEYS.has(k)) {
      issues.push({
        severity: 'warning',
        phase: 'parse',
        message: `Unknown key '${k}' in entity body`,
        location: `${loc}.${k}`,
      });
    }
  }

  // pk: required, non-empty array of strings
  if (!('pk' in b)) {
    issues.push({ severity: 'error', phase: 'parse', message: "Missing required 'pk'", location: loc });
  } else if (!Array.isArray(b.pk) || b.pk.length === 0 || !b.pk.every(c => typeof c === 'string')) {
    issues.push({
      severity: 'error',
      phase: 'parse',
      message: "'pk' must be a non-empty array of column-name strings",
      location: `${loc}.pk`,
    });
  }

  // columns: required, map of name -> {type, ...}
  if (!('columns' in b)) {
    issues.push({ severity: 'error', phase: 'parse', message: "Missing required 'columns'", location: loc });
  } else if (typeof b.columns !== 'object' || b.columns === null || Array.isArray(b.columns)) {
    issues.push({
      severity: 'error',
      phase: 'parse',
      message: "'columns' must be a mapping",
      location: `${loc}.columns`,
    });
  } else {
    for (const [colName, col] of Object.entries(b.columns)) {
      const colLoc = `${loc}.columns.${colName}`;
      if (typeof col !== 'object' || col === null || Array.isArray(col)) {
        issues.push({ severity: 'error', phase: 'parse', message: 'Column body must be a mapping', location: colLoc });
        continue;
      }
      const c = col as Record<string, unknown>;
      if (typeof c.type !== 'string') {
        issues.push({ severity: 'error', phase: 'parse', message: "Column missing 'type'", location: colLoc });
      } else if (!VALID_TYPES.includes(c.type as LogicalType)) {
        issues.push({
          severity: 'error',
          phase: 'parse',
          message: `Invalid type '${c.type}'. Must be one of: ${VALID_TYPES.join(', ')}`,
          location: colLoc,
        });
      }
      if ('nullable' in c && typeof c.nullable !== 'boolean') {
        issues.push({ severity: 'error', phase: 'parse', message: "'nullable' must be boolean", location: colLoc });
      }
    }
  }

  // ak: optional, list of {rule, columns}
  if ('ak' in b) {
    if (!Array.isArray(b.ak)) {
      issues.push({ severity: 'error', phase: 'parse', message: "'ak' must be a list", location: `${loc}.ak` });
    } else {
      b.ak.forEach((ak, i) => {
        const akLoc = `${loc}.ak[${i}]`;
        if (typeof ak !== 'object' || ak === null || Array.isArray(ak)) {
          issues.push({ severity: 'error', phase: 'parse', message: 'AK entry must be a mapping', location: akLoc });
          return;
        }
        const a = ak as Record<string, unknown>;
        if (typeof a.rule !== 'string' || a.rule.trim() === '') {
          issues.push({ severity: 'error', phase: 'parse', message: "AK missing non-empty 'rule'", location: akLoc });
        }
        if (!Array.isArray(a.columns) || a.columns.length === 0 ||
            !a.columns.every(c => typeof c === 'string')) {
          issues.push({
            severity: 'error',
            phase: 'parse',
            message: "AK 'columns' must be a non-empty array of strings",
            location: akLoc,
          });
        }
      });
    }
  }

  // relationships: optional, {identifying?, referential?}
  if ('relationships' in b) {
    if (typeof b.relationships !== 'object' || b.relationships === null || Array.isArray(b.relationships)) {
      issues.push({ severity: 'error', phase: 'parse', message: "'relationships' must be a mapping", location: `${loc}.relationships` });
    } else {
      const r = b.relationships as Record<string, unknown>;
      for (const kind of ['identifying', 'referential'] as const) {
        if (!(kind in r)) continue;
        const block = r[kind];
        if (typeof block !== 'object' || block === null || Array.isArray(block)) {
          issues.push({
            severity: 'error',
            phase: 'parse',
            message: `'relationships.${kind}' must be a mapping keyed by parent entity name`,
            location: `${loc}.relationships.${kind}`,
          });
          continue;
        }
        for (const [parent, rel] of Object.entries(block as Record<string, unknown>)) {
          const rels = Array.isArray(rel) ? rel : [rel];
          rels.forEach((rl, i) => {
            const relLoc = Array.isArray(rel)
              ? `${loc}.relationships.${kind}.${parent}[${i}]`
              : `${loc}.relationships.${kind}.${parent}`;
            issues.push(...validateRelationshipShape(rl, relLoc));
          });
        }
      }
    }
  }

  // subtypes: optional, list of clusters
  if ('subtypes' in b) {
    if (!Array.isArray(b.subtypes)) {
      issues.push({ severity: 'error', phase: 'parse', message: "'subtypes' must be a list of clusters", location: `${loc}.subtypes` });
    } else {
      b.subtypes.forEach((c, i) => {
        issues.push(...validateSubtypeClusterShape(c, `${loc}.subtypes[${i}]`));
      });
    }
  }

  // constraints: optional, list
  if ('constraints' in b) {
    if (!Array.isArray(b.constraints)) {
      issues.push({ severity: 'error', phase: 'parse', message: "'constraints' must be a list", location: `${loc}.constraints` });
    } else {
      b.constraints.forEach((c, i) => {
        const cLoc = `${loc}.constraints[${i}]`;
        if (typeof c !== 'object' || c === null || Array.isArray(c)) {
          issues.push({ severity: 'error', phase: 'parse', message: 'Constraint must be a mapping', location: cLoc });
          return;
        }
        const con = c as Record<string, unknown>;
        if (typeof con.rule !== 'string' || con.rule.trim() === '') {
          issues.push({ severity: 'error', phase: 'parse', message: "Constraint missing non-empty 'rule'", location: cLoc });
        }
        if ('spans' in con && !(Array.isArray(con.spans) && con.spans.every(s => typeof s === 'string'))) {
          issues.push({ severity: 'error', phase: 'parse', message: "'spans' must be an array of entity-name strings", location: cLoc });
        }
      });
    }
  }

  // groups: optional, array of strings
  if ('groups' in b) {
    if (!Array.isArray(b.groups) || !b.groups.every(g => typeof g === 'string')) {
      issues.push({ severity: 'error', phase: 'parse', message: "'groups' must be an array of strings", location: `${loc}.groups` });
    }
  }

  return issues;
}

function validateRelationshipShape(rel: unknown, loc: string): Issue[] {
  const issues: Issue[] = [];
  if (typeof rel !== 'object' || rel === null || Array.isArray(rel)) {
    issues.push({ severity: 'error', phase: 'parse', message: 'Relationship entry must be a mapping', location: loc });
    return issues;
  }
  const r = rel as Record<string, unknown>;

  for (const k of Object.keys(r)) {
    if (!RELATIONSHIP_KEYS.has(k)) {
      issues.push({ severity: 'warning', phase: 'parse', message: `Unknown key '${k}' in relationship`, location: `${loc}.${k}` });
    }
  }

  if (!('on' in r)) {
    issues.push({ severity: 'error', phase: 'parse', message: "Relationship missing 'on' anchor", location: loc });
  } else if (typeof r.on !== 'object' || r.on === null || Array.isArray(r.on)) {
    issues.push({ severity: 'error', phase: 'parse', message: "'on' must be a mapping of child column to parent column", location: `${loc}.on` });
  } else {
    for (const [cc, pc] of Object.entries(r.on)) {
      if (typeof cc !== 'string' || typeof pc !== 'string') {
        issues.push({ severity: 'error', phase: 'parse', message: "'on' entries must map string to string", location: `${loc}.on` });
        break;
      }
    }
  }

  if (!('predicate' in r)) {
    issues.push({ severity: 'error', phase: 'parse', message: "Relationship missing 'predicate'", location: loc });
  } else {
    const p = r.predicate as Record<string, unknown>;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      issues.push({ severity: 'error', phase: 'parse', message: "'predicate' must be { fwd, rev }", location: `${loc}.predicate` });
    } else {
      if (typeof p.fwd !== 'string' || p.fwd.trim() === '') {
        issues.push({ severity: 'error', phase: 'parse', message: "'predicate.fwd' must be a non-empty string", location: `${loc}.predicate.fwd` });
      }
      if (typeof p.rev !== 'string' || p.rev.trim() === '') {
        issues.push({ severity: 'error', phase: 'parse', message: "'predicate.rev' must be a non-empty string", location: `${loc}.predicate.rev` });
      }
    }
  }

  return issues;
}

function validateSubtypeClusterShape(c: unknown, loc: string): Issue[] {
  const issues: Issue[] = [];
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    issues.push({ severity: 'error', phase: 'parse', message: 'Subtype cluster must be a mapping', location: loc });
    return issues;
  }
  const cl = c as Record<string, unknown>;

  if (typeof cl.exclusive !== 'boolean') {
    issues.push({ severity: 'error', phase: 'parse', message: "'exclusive' must be boolean", location: `${loc}.exclusive` });
  }

  if (!('members' in cl)) {
    issues.push({ severity: 'error', phase: 'parse', message: "Cluster missing 'members'", location: loc });
    return issues;
  }

  if (cl.exclusive === true) {
    if (typeof cl.members !== 'object' || cl.members === null || Array.isArray(cl.members)) {
      issues.push({ severity: 'error', phase: 'parse', message: "Exclusive cluster 'members' must be a mapping of subtype name to discriminator", location: `${loc}.members` });
    } else {
      for (const [sname, disc] of Object.entries(cl.members)) {
        if (typeof disc !== 'object' || disc === null || Array.isArray(disc)) {
          issues.push({ severity: 'error', phase: 'parse', message: `Subtype '${sname}' discriminator must be { column: classifierPath }`, location: `${loc}.members.${sname}` });
        }
      }
    }
  } else if (cl.exclusive === false) {
    if (!Array.isArray(cl.members) || !cl.members.every(m => typeof m === 'string')) {
      issues.push({ severity: 'error', phase: 'parse', message: "Inclusive cluster 'members' must be a list of subtype name strings", location: `${loc}.members` });
    }
  }

  return issues;
}
