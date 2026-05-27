// =============================================================================
// validate.ts — Stage 4: semantic validation against the built+derived Model.
//
// Stage 1 (parse) already caught structural errors. This stage catches
// SEMANTIC errors: references that don't resolve, cycles, mismatched PKs, etc.
// =============================================================================

import { Model, Issue, Edge, Node } from './types';

export function validate(model: Model): Issue[] {
  const issues: Issue[] = [];

  validateGroupRefs(model, issues);
  validatePks(model, issues);
  validateColumnRefs(model, issues);
  validateIdentifyingAnchors(model, issues);
  validateSubtypePks(model, issues);
  validateSubtypeMembership(model, issues);
  validateClassifierPaths(model, issues);
  validateConstraintSpans(model, issues);
  validateNoIdentifyingCycles(model, issues);
  validateIdUniqueness(model, issues);
  validateIdentifyingFkNonNullable(model, issues);

  return issues;
}

// 1. Every group named on an entity (effective or primary) must exist in registry.
function validateGroupRefs(model: Model, issues: Issue[]): void {
  for (const node of model.nodes.values()) {
    for (const g of node.effectiveGroups) {
      if (!model.groups.has(g)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Unknown group '${g}'`,
          location: node.name,
        });
      }
    }
  }
}

// 2/3. PK non-empty and PK columns exist on the entity.
function validatePks(model: Model, issues: Issue[]): void {
  for (const node of model.nodes.values()) {
    if (node.pk.length === 0) {
      issues.push({ severity: 'error', phase: 'validate', message: 'PK is empty', location: node.name });
      continue;
    }
    const colNames = new Set(node.columns.map(c => c.name));
    for (const pkCol of node.pk) {
      if (!colNames.has(pkCol)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `PK column '${pkCol}' is not declared in columns`,
          location: `${node.name}.pk`,
        });
      }
    }
  }
}

// 4/6. AK columns and anchor columns exist on both ends of each edge.
function validateColumnRefs(model: Model, issues: Issue[]): void {
  for (const node of model.nodes.values()) {
    const cols = new Set(node.columns.map(c => c.name));
    for (const a of node.ak) {
      for (const c of a.columns) {
        if (!cols.has(c)) {
          issues.push({
            severity: 'error',
            phase: 'validate',
            message: `AK '${a.id}' references undeclared column '${c}'`,
            location: node.name,
          });
        }
      }
    }
  }

  for (const e of model.edges) {
    const child = model.nodes.get(e.child);
    const parent = model.nodes.get(e.parent);
    if (!child || !parent) continue;
    const childCols = new Set(child.columns.map(c => c.name));
    const parentCols = new Set(parent.columns.map(c => c.name));
    for (const [cc, pc] of e.on) {
      if (!childCols.has(cc)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Edge ${e.parent}->${e.child}: child column '${cc}' not declared`,
          location: e.child,
        });
      }
      if (!parentCols.has(pc)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Edge ${e.parent}->${e.child}: parent column '${pc}' not declared`,
          location: e.parent,
        });
      }
    }
  }
}

// 7. Identifying edge's parent-side anchor columns must equal the parent's PK.
function validateIdentifyingAnchors(model: Model, issues: Issue[]): void {
  for (const e of model.edges) {
    if (e.kind !== 'identifying') continue;
    const parent = model.nodes.get(e.parent);
    if (!parent) continue;
    const parentColsInOn = new Set(e.on.values());
    const parentPk = new Set(parent.pk);
    if (parentColsInOn.size !== parentPk.size || ![...parentPk].every(p => parentColsInOn.has(p))) {
      issues.push({
        severity: 'error',
        phase: 'validate',
        message: `Identifying edge ${e.parent}->${e.child}: on-map parent columns ` +
                 `{${[...parentColsInOn].join(', ')}} must equal parent PK {${[...parentPk].join(', ')}}`,
        location: e.child,
      });
    }
  }
}

// 8. Subtype's PK equals basetype's PK.
function validateSubtypePks(model: Model, issues: Issue[]): void {
  for (const c of model.subtypeClusters) {
    const base = model.nodes.get(c.basetype);
    if (!base) continue;
    for (const m of c.members) {
      const sub = model.nodes.get(m.subtype);
      if (!sub) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Subtype '${m.subtype}' referenced by basetype '${c.basetype}' but not declared`,
          location: c.basetype,
        });
        continue;
      }
      const subSet = new Set(sub.pk);
      const baseSet = new Set(base.pk);
      if (subSet.size !== baseSet.size || ![...baseSet].every(p => subSet.has(p))) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Subtype '${m.subtype}' PK must equal basetype '${c.basetype}' PK`,
          location: m.subtype,
        });
      }
    }
  }
}

// 9. Each subtype belongs to exactly one cluster.
function validateSubtypeMembership(model: Model, issues: Issue[]): void {
  const seen = new Map<string, string>();   // subtype -> basetype it's a member of
  for (const c of model.subtypeClusters) {
    for (const m of c.members) {
      if (seen.has(m.subtype)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Subtype '${m.subtype}' is a member of multiple clusters (${seen.get(m.subtype)} and ${c.basetype})`,
          location: m.subtype,
        });
      } else {
        seen.set(m.subtype, c.basetype);
      }
    }
  }
}

// 10. Exclusive-cluster classifier paths resolve.
function validateClassifierPaths(model: Model, issues: Issue[]): void {
  for (const c of model.subtypeClusters) {
    if (!c.exclusive) continue;
    for (const m of c.members) {
      if (!m.discriminator) continue;
      const path = m.discriminator.classifierPath;
      const parts = path.split('.');
      if (parts.length !== 3) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Classifier path '${path}' must be in 'Table.column.VALUE' form`,
          location: m.subtype,
        });
        continue;
      }
      const [tblName, colName, value] = parts;
      const tbl = model.nodes.get(tblName);
      if (!tbl) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Classifier path '${path}': table '${tblName}' not found`,
          location: m.subtype,
        });
        continue;
      }
      const tblCol = tbl.columns.find(c => c.name === colName);
      if (!tblCol) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Classifier path '${path}': column '${colName}' not found on '${tblName}'`,
          location: m.subtype,
        });
        continue;
      }
      // Check value exists in tbl.values
      const valueFound = tbl.values?.some(v => v[colName] === value);
      if (!valueFound) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Classifier path '${path}': value '${value}' not found in ${tblName}.values`,
          location: m.subtype,
        });
      }
    }
  }
}

// 11. Constraint spans must reference real entities.
function validateConstraintSpans(model: Model, issues: Issue[]): void {
  for (const span of model.constraintSpans) {
    if (!model.nodes.has(span.target)) {
      issues.push({
        severity: 'error',
        phase: 'validate',
        message: `Constraint '${span.constraintId}' spans unknown entity '${span.target}'`,
        location: span.source,
      });
    }
  }
}

// 12. No cycles in the identifying-edge subgraph.
function validateNoIdentifyingCycles(model: Model, issues: Issue[]): void {
  const adj = new Map<string, string[]>();
  for (const e of model.edges) {
    if (e.kind !== 'identifying') continue;
    if (!adj.has(e.parent)) adj.set(e.parent, []);
    adj.get(e.parent)!.push(e.child);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of model.nodes.keys()) color.set(n, WHITE);

  function dfs(n: string, stack: string[]): boolean {
    color.set(n, GRAY);
    for (const next of adj.get(n) ?? []) {
      if (color.get(next) === GRAY) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Identifying cycle: ${[...stack, next].join(' -> ')}`,
        });
        return true;
      }
      if (color.get(next) === WHITE) {
        if (dfs(next, [...stack, next])) return true;
      }
    }
    color.set(n, BLACK);
    return false;
  }

  for (const n of model.nodes.keys()) {
    if (color.get(n) === WHITE) dfs(n, [n]);
  }
}

// 13. Derived IDs are globally unique.
function validateIdUniqueness(model: Model, issues: Issue[]): void {
  const seen = new Map<string, string>();   // id -> origin
  for (const node of model.nodes.values()) {
    for (const a of node.ak) {
      if (seen.has(a.id)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Duplicate AK id '${a.id}' (also defined in ${seen.get(a.id)})`,
          location: node.name,
        });
      } else {
        seen.set(a.id, node.name);
      }
    }
    for (const c of node.constraints) {
      if (seen.has(c.id)) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Duplicate constraint id '${c.id}' (also defined in ${seen.get(c.id)})`,
          location: node.name,
        });
      } else {
        seen.set(c.id, node.name);
      }
    }
  }
}

// 15. Identifying FKs must be non-nullable (the FK is part of the child's PK).
function validateIdentifyingFkNonNullable(model: Model, issues: Issue[]): void {
  for (const e of model.edges) {
    if (e.kind !== 'identifying') continue;
    const child = model.nodes.get(e.child);
    if (!child) continue;
    const colByName = new Map(child.columns.map(c => [c.name, c]));
    for (const cc of e.on.keys()) {
      const col = colByName.get(cc);
      if (col?.nullable) {
        issues.push({
          severity: 'error',
          phase: 'validate',
          message: `Identifying edge ${e.parent}->${e.child}: FK column '${cc}' is nullable`,
          location: e.child,
        });
      }
    }
  }
}
