/**
 * Pure validation layer for the parsed Model.
 *
 * `validateModel` is intentionally free of Node/Bun I/O — it imports only types
 * from `./parse` so the module remains browser-safe and unit-testable with
 * plain Model literals.
 *
 * Registry shape: `Record<RuleId, RuleEntry>` — every RuleId must have an entry.
 * TypeScript compile-errors if a rule is missing from the registry.
 */

import type { Model, ModelNode, ModelEdge, SubtypeCluster } from './parse';

// ---------------------------------------------------------------------------
// Rule IDs — exhaustive union covering all catalog rules (design doc §Rule catalog)
// CP-1 only *implements* entity.* rules; the full union is declared here so
// later CPs can extend the registry without changing this type.
// ---------------------------------------------------------------------------

export type RuleId =
  // parse-time (CP-2)
  | 'parse.invalid_yaml'
  | 'parse.missing_id'
  | 'parse.empty_frontmatter'
  // entity (CP-1)
  | 'entity.missing_pk'
  | 'entity.missing_columns'
  | 'entity.invalid_field_type'
  | 'entity.unknown_group'
  // edge (CP-2)
  | 'edge.unknown_target'
  | 'edge.dangling_fk_column'
  // cluster (CP-2)
  | 'cluster.missing_basetype'
  | 'cluster.missing_member'
  | 'cluster.no_discriminator';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type EntityError = {
  ruleId: RuleId;
  entityId: string;
  severity: 'warning';
  message: string;
};

/**
 * CP-1 does not emit GlobalErrors but the type is exported so CP-2+ can use it
 * without changing the module's public surface.
 */
export type GlobalError = {
  ruleId: RuleId;
  severity: 'error';
  omitted: { kind: 'entity' | 'edge' | 'cluster' | 'file'; id: string };
  reason: string;
};

export type ValidationResult = {
  entityErrors: EntityError[];
  globalErrors: GlobalError[];
  cleanedModel: Model;
};

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

export type RuleEntry = {
  title: string;
  explanation: string;
  /** 'A' = render degraded + warning triangle; 'B' = omit + global banner */
  class: 'A' | 'B';
};

/**
 * Complete registry: every RuleId maps to a RuleEntry.
 * TypeScript will compile-error if any RuleId is missing an entry.
 */
export const RULES: Record<RuleId, RuleEntry> = {
  'entity.missing_pk': {
    title: 'Missing primary key',
    explanation: 'The entity declares an empty `pk` array. Every entity must have at least one primary-key column. Without a PK the cardinality derivation falls back to dependent and FK links may be incorrect.',
    class: 'A',
  },
  'entity.missing_columns': {
    title: 'No columns defined',
    explanation: 'The entity has no `columns` field declared. At minimum the PK columns should be listed with their types. An entity with intentionally no non-PK attributes (e.g. a PK-only intersection table) may declare an empty `columns: {}` without triggering this warning.',
    class: 'A',
  },
  'entity.invalid_field_type': {
    title: 'Invalid field shape',
    explanation: 'A required field on the entity (e.g. `pk`) has the wrong runtime type. For example `pk` must be an array of strings, not a plain string. The validator coerces to a safe default but the schema file should be corrected.',
    class: 'A',
  },
  'entity.unknown_group': {
    title: 'Unknown group',
    explanation: 'The entity references a group that has no corresponding `_groups/<name>.md` file. The entity will render without a group color band. Create the group file or correct the group name.',
    class: 'A',
  },
  'parse.invalid_yaml': {
    title: 'Invalid YAML frontmatter',
    explanation: 'The file\'s YAML frontmatter could not be parsed. The file is excluded from the model. Fix the YAML syntax (check for unclosed brackets, bad indentation, or invalid characters).',
    class: 'B',
  },
  'parse.missing_id': {
    title: 'Missing entity id',
    explanation: 'The frontmatter parsed successfully but has no `entity` field. Every entity file must declare `entity: <EntityName>`. The file is excluded from the model.',
    class: 'B',
  },
  'parse.empty_frontmatter': {
    title: 'Empty frontmatter',
    explanation: 'The file has YAML fences (`---`) but no content between them. Every entity file must have frontmatter with at least an `entity` field. The file is excluded from the model.',
    class: 'B',
  },
  'edge.unknown_target': {
    title: 'Edge target not in model',
    explanation: 'An edge references a target entity that does not exist in the model. The dangling edge is stripped from the cleaned model. Add the missing entity file or correct the target name.',
    class: 'B',
  },
  'edge.dangling_fk_column': {
    title: 'FK column not on source entity',
    explanation: 'An edge\'s `on` mapping references a column that does not exist on the source entity. The edge is preserved but the source entity is flagged. Add the missing column to the source entity or correct the `on` mapping.',
    class: 'A',
  },
  'cluster.missing_basetype': {
    title: 'Subtype cluster basetype not in model',
    explanation: 'A subtype cluster declares a basetype entity that does not exist in the model. The entire cluster is stripped from the cleaned model. Add the missing basetype entity file or correct the basetype name.',
    class: 'B',
  },
  'cluster.missing_member': {
    title: 'Subtype cluster member not in model',
    explanation: 'A subtype cluster lists a member entity that does not exist in the model. The missing member is dropped from the cleaned model; the cluster itself is preserved. Add the missing member entity file or remove it from the cluster.',
    class: 'A',
  },
  'cluster.no_discriminator': {
    title: 'Subtype cluster has no discriminator column',
    explanation: 'The subtype cluster was declared with a plain list of members (no discriminator values). An IDEF1X-compliant subtype cluster should include a discriminator column to indicate which subtype each basetype row belongs to. Add discriminator values using the object form of `members`.',
    class: 'A',
  },
};

// ---------------------------------------------------------------------------
// Rule predicates — one function per entity rule
// Each returns an EntityError[] (empty = no violation).
// ---------------------------------------------------------------------------

function checkMissingPk(node: ModelNode): EntityError[] {
  const pk = node.pk;
  // entity.invalid_field_type catches non-array pk first; here we only check empty array
  if (!Array.isArray(pk) || pk.length > 0) return [];
  return [{
    ruleId: 'entity.missing_pk',
    entityId: node.id,
    severity: 'warning',
    message: `Entity '${node.id}' has no primary-key columns (pk is empty).`,
  }];
}

function checkMissingColumns(node: ModelNode): EntityError[] {
  // Only fires when `columns` is missing (undefined). An entity with intentionally
  // no non-PK attributes (PK-only intersection table) may declare `columns: {}`.
  if (node.columns !== undefined) return [];
  return [{
    ruleId: 'entity.missing_columns',
    entityId: node.id,
    severity: 'warning',
    message: `Entity '${node.id}' has no columns defined.`,
  }];
}

function checkInvalidFieldType(node: ModelNode): EntityError[] {
  const errors: EntityError[] = [];

  // pk must be an array
  if (!Array.isArray(node.pk)) {
    errors.push({
      ruleId: 'entity.invalid_field_type',
      entityId: node.id,
      severity: 'warning',
      message: `Entity '${node.id}': 'pk' must be an array of strings, got ${typeof node.pk}.`,
    });
  }

  // columns must be an object (or at least not an array/primitive); typeof handles null cleanly
  if (Array.isArray(node.columns) || (node.columns !== undefined && typeof node.columns !== 'object')) {
    errors.push({
      ruleId: 'entity.invalid_field_type',
      entityId: node.id,
      severity: 'warning',
      message: `Entity '${node.id}': 'columns' must be a record object, got ${typeof node.columns}.`,
    });
  }

  return errors;
}

function checkUnknownGroup(node: ModelNode, groups: Record<string, unknown>): EntityError[] {
  if (!node.group) return [];
  if (node.group in groups) return [];
  return [{
    ruleId: 'entity.unknown_group',
    entityId: node.id,
    severity: 'warning',
    message: `Entity '${node.id}' references group '${node.group}' which has no corresponding _groups file.`,
  }];
}

// ---------------------------------------------------------------------------
// Edge rule detectors
// ---------------------------------------------------------------------------

function checkEdgeUnknownTarget(
  edge: ModelEdge,
  nodeIds: Set<string>,
): GlobalError | null {
  if (nodeIds.has(edge.target)) return null;
  return {
    ruleId: 'edge.unknown_target',
    severity: 'error',
    omitted: { kind: 'edge', id: `${edge.source}→${edge.target}` },
    reason: `Edge target "${edge.target}" not present in model.`,
  };
}

function checkEdgeDanglingFkColumn(
  edge: ModelEdge,
  sourceNode: ModelNode | undefined,
): EntityError[] {
  if (!sourceNode) return [];
  const sourceCols = new Set(Object.keys(sourceNode.columns ?? {}));
  const missing = Object.keys(edge.on).filter(col => !sourceCols.has(col));
  if (missing.length === 0) return [];
  return [{
    ruleId: 'edge.dangling_fk_column',
    entityId: sourceNode.id,
    severity: 'warning',
    message: `Entity '${sourceNode.id}' edge to '${edge.target}' references column(s) not present on source: ${missing.join(', ')}.`,
  }];
}

// ---------------------------------------------------------------------------
// Cluster rule detectors
// ---------------------------------------------------------------------------

function checkClusterMissingBasetype(
  cluster: SubtypeCluster,
  nodeIds: Set<string>,
): GlobalError | null {
  if (nodeIds.has(cluster.basetype)) return null;
  return {
    ruleId: 'cluster.missing_basetype',
    severity: 'error',
    omitted: { kind: 'cluster', id: cluster.basetype },
    reason: `Subtype cluster basetype "${cluster.basetype}" not present in model.`,
  };
}

function checkClusterMissingMembers(
  cluster: SubtypeCluster,
  nodeIds: Set<string>,
): EntityError[] {
  const missing = cluster.members.filter(m => !nodeIds.has(m));
  if (missing.length === 0) return [];
  return [{
    ruleId: 'cluster.missing_member',
    entityId: cluster.basetype,
    severity: 'warning',
    message: `Subtype cluster for '${cluster.basetype}' references missing member(s): ${missing.join(', ')}.`,
  }];
}

function checkClusterNoDiscriminator(cluster: SubtypeCluster): EntityError[] {
  if (cluster.hasDiscriminator) return [];
  return [{
    ruleId: 'cluster.no_discriminator',
    entityId: cluster.basetype,
    severity: 'warning',
    message: `Subtype cluster for '${cluster.basetype}' has no discriminator column declared.`,
  }];
}

// ---------------------------------------------------------------------------
// validateModel
// ---------------------------------------------------------------------------

export function validateModel(model: Model): ValidationResult {
  const entityErrors: EntityError[] = [];
  const globalErrors: GlobalError[] = [];

  // Build a fast id lookup for nodes
  const nodeIds = new Set(model.nodes.map(n => n.id));
  const nodeById = new Map<string, ModelNode>(model.nodes.map(n => [n.id, n]));

  // Entity rules
  for (const node of model.nodes) {
    entityErrors.push(
      ...checkInvalidFieldType(node),
      ...checkMissingPk(node),
      ...checkMissingColumns(node),
      ...checkUnknownGroup(node, model.groups),
    );
  }

  // Edge rules — Class B (unknown_target) strips edge from cleanedModel
  const strippedEdgeTargets = new Set<string>(); // track stripped edge signatures
  const cleanedEdges: typeof model.edges = [];
  for (const edge of model.edges) {
    const unknownTargetError = checkEdgeUnknownTarget(edge, nodeIds);
    if (unknownTargetError) {
      globalErrors.push(unknownTargetError);
      strippedEdgeTargets.add(`${edge.source}→${edge.target}`);
      // Class B: strip from cleanedModel
    } else {
      // Class A: check dangling FK columns
      entityErrors.push(...checkEdgeDanglingFkColumn(edge, nodeById.get(edge.source)));
      cleanedEdges.push(edge);
    }
  }

  // Cluster rules
  const cleanedClusters: typeof model.subtypeClusters = [];
  for (const cluster of model.subtypeClusters) {
    const missingBasetypeError = checkClusterMissingBasetype(cluster, nodeIds);
    if (missingBasetypeError) {
      globalErrors.push(missingBasetypeError);
      // Class B: strip entire cluster from cleanedModel
      continue;
    }

    // Cluster stays — check members and discriminator
    entityErrors.push(...checkClusterMissingMembers(cluster, nodeIds));
    entityErrors.push(...checkClusterNoDiscriminator(cluster));

    // Drop missing members from cleanedModel cluster (Class A: cluster stays)
    const cleanedMembers = cluster.members.filter(m => nodeIds.has(m));
    cleanedClusters.push({ ...cluster, members: cleanedMembers });
  }

  const cleanedModel: Model = {
    ...model,
    edges: cleanedEdges,
    subtypeClusters: cleanedClusters,
  };

  return {
    entityErrors,
    globalErrors,
    cleanedModel,
  };
}

// ---------------------------------------------------------------------------
// CLI stderr helper
// ---------------------------------------------------------------------------

/**
 * Format all findings from a CLI invocation into sorted lines for stderr.
 *
 * Format: "<severity>  <ruleId>  <location>  <message>"
 *
 * Sort order:
 *  1. errors before warnings
 *  2. ruleId alphabetical within each severity group
 *  3. location alphabetical within each ruleId group
 *
 * WHY exported from validate.ts: the helper is pure (no I/O), depends only on
 * the finding types, and is useful to any consumer — keeping it here avoids
 * duplicating the sort + format logic across cli.ts call sites.
 */
export function formatFindingsForStderr(
  globalErrors: GlobalError[],
  entityErrors: EntityError[],
): string[] {
  type Row = { severity: 'error' | 'warning'; ruleId: RuleId; location: string; message: string };

  const rows: Row[] = [
    ...globalErrors.map(e => ({
      severity: 'error' as const,
      ruleId: e.ruleId,
      location: e.omitted.id,
      message: e.reason,
    })),
    ...entityErrors.map(e => ({
      severity: 'warning' as const,
      ruleId: e.ruleId,
      location: e.entityId,
      message: e.message,
    })),
  ];

  rows.sort((a, b) => {
    // errors before warnings
    const sevOrder = (s: 'error' | 'warning') => (s === 'error' ? 0 : 1);
    const sevDiff = sevOrder(a.severity) - sevOrder(b.severity);
    if (sevDiff !== 0) return sevDiff;
    // ruleId alphabetical
    if (a.ruleId < b.ruleId) return -1;
    if (a.ruleId > b.ruleId) return 1;
    // location alphabetical
    if (a.location < b.location) return -1;
    if (a.location > b.location) return 1;
    return 0;
  });

  return rows.map(r => {
    const sev = r.severity === 'error' ? 'error' : 'warn';
    return `${sev}  ${r.ruleId}  ${r.location}  ${r.message}`;
  });
}
