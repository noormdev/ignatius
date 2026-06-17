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
// Type-only import from flow-validate. Both directions are import type (erased at runtime)
// so there is no runtime circular dependency — flow-validate.ts imports type RuleId from here.
import type { FlowError } from '../flows/flow-validate';

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
  | 'entity.ak_unknown_column'
  // entity (CP-2) — live-only advisory
  | 'entity.example_unknown_column'
  // body (CP-2)
  | 'body.unknown_link'
  // edge (CP-2)
  | 'edge.unknown_target'
  | 'edge.dangling_fk_column'
  // cluster (CP-2)
  | 'cluster.missing_basetype'
  | 'cluster.missing_member'
  | 'cluster.no_discriminator'
  // flow (CP-2 validator)
  | 'flow.unknown_store'
  | 'flow.unknown_external'
  | 'flow.unknown_process'
  | 'flow.unknown_attribute'
  | 'flow.ambiguous_endpoint'
  | 'flow.process_no_input'
  | 'flow.process_no_output'
  | 'flow.illegal_connection'
  | 'flow.process_to_process'
  | 'flow.unbalanced_decomposition'
  | 'flow.duplicate_number'
  | 'flow.store_naming_collision';

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
  /**
   * When true, the rule is surfaced only in live mode (graph viewer findings
   * panel, /api/model payload). `formatFindingsForStderr` omits liveOnly rows
   * so CI stderr stays quiet, and the static dict generator's findings banner
   * omits them too (CP-3). Omitted or false = default behavior, all surfaces.
   */
  liveOnly?: boolean;
  /**
   * When true, the rule can be silenced via config (e.g. ignatius.yml
   * `flow_rules: { process_to_process: false }`). The silenceable flag is
   * informational for tooling; the config key is the enforcement mechanism.
   * Only `flow.process_to_process` currently sets this.
   */
  silenceable?: boolean;
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
    explanation: 'The entity has no `columns` field declared, or the field is empty. The entity renders with an empty attribute table — declare at least the PK columns with their types.',
    class: 'A',
  },
  'entity.invalid_field_type': {
    title: 'Invalid field shape',
    explanation: 'A required field on the entity (e.g. `pk`) has the wrong runtime type. For example `pk` must be an array of strings, not a plain string. The validator coerces to a safe default but the schema file should be corrected.',
    class: 'A',
  },
  'entity.unknown_group': {
    title: 'Unknown group',
    explanation: 'The entity references a group that has no corresponding `groups/<name>.md` file. The entity will render without a group color band. Create the group file or correct the group name.',
    class: 'A',
  },
  'entity.ak_unknown_column': {
    title: 'Alternate key references unknown column',
    explanation: 'An `ak` entry lists a column that is not declared in the entity\'s `pk` or `columns`. The alternate key is silently ignored — and with it the uniqueness signal the cardinality derivation depends on, so a referential FK that should resolve to one-to-one renders as one-to-many. Add the column to `columns`, or correct the column name in the `ak` entry.',
    class: 'A',
  },
  'entity.example_unknown_column': {
    title: 'Example row contains unknown column',
    explanation: 'An example row includes a key that is not declared in the entity\'s `pk` or `columns`. The example renders as-is but the unknown key has no column header. Add the key to `columns`, correct the key name, or remove it from the example.',
    class: 'A',
    liveOnly: true,
  },
  'body.unknown_link': {
    title: 'Body links to unknown entity',
    explanation: 'A `[[Entity]]` link in the body markdown names an entity that does not exist in the model. The link renders as non-navigating text. Correct the entity id (match it exactly, PascalCase) or remove the link.',
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
    title: 'Exclusive subtype cluster has no discriminator',
    explanation: 'An exclusive subtype cluster needs a column whose value identifies which subtype a basetype instance is. Convert the members from array form to object form (`MemberName: { col: value }`) to declare the discriminator. Inclusive clusters (`exclusive: false`) do not need a discriminator — multiple subtypes can coexist for the same basetype row.',
    class: 'A',
  },
  // flow rules
  'flow.unknown_store': {
    title: 'Flow references unknown db: store',
    explanation: 'A `db:` endpoint names an entity id that does not exist in the entity catalog. The flow edges touching this store are stripped from the cleaned model. Add the entity file or correct the store name.',
    class: 'B',
  },
  'flow.unknown_external': {
    title: 'Flow references unknown external',
    explanation: 'A `ext:` endpoint names an external that has no `externals/<name>.md` file at the model root. The flow edges touching this external are stripped. Add the external file or correct the name.',
    class: 'B',
  },
  'flow.unknown_process': {
    title: 'Flow references unknown process',
    explanation: 'A `proc:` endpoint names a process that does not exist in this DFD. The flow edges touching this process are stripped. Add the process file or correct the name.',
    class: 'B',
  },
  'flow.unknown_attribute': {
    title: 'Flow references unknown entity attribute',
    explanation: 'A `db:` flow edge lists a column that is not declared on the entity (not in `pk` or `columns`). Add the column to the entity or correct the column name in the flow `data` field.',
    class: 'A',
  },
  'flow.ambiguous_endpoint': {
    title: 'Ambiguous bare endpoint name',
    explanation: 'A bare (unqualified) endpoint name matches more than one namespace (e.g. both an external and a process share the same name). Qualify the endpoint with a `kind:` prefix (e.g. `ext:Name`, `proc:Name`) to disambiguate.',
    class: 'A',
  },
  'flow.process_no_input': {
    title: 'Process has no input flows',
    explanation: 'A process has zero input edges after removing Class B violations. Every process should receive data from at least one source. Add an input flow or remove the process.',
    class: 'A',
  },
  'flow.process_no_output': {
    title: 'Process has no output flows',
    explanation: 'A process has zero output edges after removing Class B violations. Every process should produce data to at least one destination. Add an output flow or remove the process.',
    class: 'A',
  },
  'flow.illegal_connection': {
    title: 'Illegal direct connection between non-process nodes',
    explanation: 'A flow edge connects two nodes where neither is a process (e.g. store-to-store, external-to-store, external-to-external). Data flow diagrams require all data to move through processes. The edge is stripped from the cleaned model.',
    class: 'B',
  },
  'flow.process_to_process': {
    title: 'Direct process-to-process flow',
    explanation: 'A flow edge connects two processes directly, with no intervening store or external. This is usually a sign of missing decomposition or a missing store. Silence this rule with `flow_rules: { process_to_process: false }` in `ignatius.yml` if intentional.',
    class: 'A',
    silenceable: true,
  },
  'flow.unbalanced_decomposition': {
    title: 'Sub-DFD boundary columns do not match parent process',
    explanation: 'The set of data columns crossing the boundary of a sub-DFD (edges to/from non-process endpoints outside the sub-DFD) does not match the columns on the parent process\'s own inputs/outputs for the same connections. Update the sub-DFD edges or the parent process edges so the column sets match.',
    class: 'A',
  },
  'flow.duplicate_number': {
    title: 'Duplicate sibling process number',
    explanation: 'Two sibling processes in the same DFD declare the same local `number:` value. Local numbers must be unique among siblings. Correct the `number:` fields so each sibling has a distinct rank.',
    class: 'A',
  },
  'flow.store_naming_collision': {
    title: 'Store token conflict across diagrams',
    explanation: 'The same store token (kind:name) appears in multiple diagrams with conflicting `kind` or `title` attributes. The derivation cannot silently merge them. Reconcile the store definition across the affected diagrams so the token resolves consistently.',
    class: 'A',
  },
};

// ---------------------------------------------------------------------------
// Rule predicates — one function per entity rule
// Each returns an EntityError[] (empty = no violation).
// ---------------------------------------------------------------------------

function checkMissingPk(node: ModelNode): EntityError[] {
  // Singleton entities (one-row config/settings tables) have no meaningful PK.
  if (node.singleton) return [];
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
  // Fires when `columns` is missing OR empty. parse.ts defaults missing columns
  // to `{}` so undefined-only never fires in practice; emptiness is what consumers
  // need flagged ("this entity renders an empty attribute table").
  if (
    node.columns !== undefined &&
    node.columns !== null &&
    typeof node.columns === 'object' &&
    !Array.isArray(node.columns) &&
    Object.keys(node.columns).length > 0
  ) {
    return [];
  }
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

function checkBodyLinks(node: ModelNode, nodeIds: Set<string>): EntityError[] {
  const links = node.bodyLinks;
  if (!links || links.length === 0) return [];
  // One finding per distinct unknown target; a target repeated in the body is
  // reported once.
  const seen = new Set<string>();
  const errors: EntityError[] = [];
  for (const target of links) {
    if (nodeIds.has(target) || seen.has(target)) continue;
    seen.add(target);
    errors.push({
      ruleId: 'body.unknown_link',
      entityId: node.id,
      severity: 'warning',
      message: `Body links to unknown entity '${target}'.`,
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
    message: `Entity '${node.id}' references group '${node.group}' which has no corresponding groups file.`,
  }];
}

function checkAlternateKeys(node: ModelNode): EntityError[] {
  const aks = node.alternateKeys;
  if (!Array.isArray(aks) || aks.length === 0) return [];

  // An AK column must be declared — either a pk column or a regular column.
  const validKeys = new Set<string>([
    ...(Array.isArray(node.pk) ? node.pk : []),
    ...Object.keys(node.columns ?? {}),
  ]);

  const errors: EntityError[] = [];
  for (const ak of aks) {
    if (!ak || !Array.isArray(ak.columns)) continue;
    for (const col of ak.columns) {
      if (validKeys.has(col)) continue;
      errors.push({
        ruleId: 'entity.ak_unknown_column',
        entityId: node.id,
        severity: 'warning',
        message: `Entity '${node.id}' alternate key '${ak.rule}' references unknown column '${col}' (not in pk or columns).`,
      });
    }
  }
  return errors;
}

function checkExampleColumns(node: ModelNode): EntityError[] {
  if (!node.examples || node.examples.length === 0) return [];

  // Build the set of valid keys: all pk columns + all declared columns
  const validKeys = new Set<string>([
    ...(Array.isArray(node.pk) ? node.pk : []),
    ...Object.keys(node.columns ?? {}),
  ]);

  const errors: EntityError[] = [];
  for (let i = 0; i < node.examples.length; i++) {
    const row = node.examples[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) {
      if (!validKeys.has(key)) {
        errors.push({
          ruleId: 'entity.example_unknown_column',
          entityId: node.id,
          severity: 'warning',
          message: `Entity '${node.id}' example row ${i} contains unknown key '${key}' (not in pk or columns).`,
        });
      }
    }
  }
  return errors;
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
  // Only exclusive clusters need a discriminator. In inclusive clusters every
  // subtype can coexist for a basetype instance, so no single column can
  // partition them — flagging them as missing-discriminator is a false positive.
  if (!cluster.exclusive) return [];
  if (cluster.hasDiscriminator) return [];
  return [{
    ruleId: 'cluster.no_discriminator',
    entityId: cluster.basetype,
    severity: 'warning',
    message: `Subtype cluster for '${cluster.basetype}' is exclusive but has no discriminator column declared.`,
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
      ...checkAlternateKeys(node),
      ...checkExampleColumns(node),
      ...checkBodyLinks(node, nodeIds),
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

  // Coerce nodes with invalid pk/columns shapes to safe defaults so downstream
  // consumers (dict, graph) never crash on bad data. The original EntityError
  // already informs the user; cleanedModel exists to keep render paths total.
  const cleanedNodes = model.nodes.map(node => {
    const safePk = Array.isArray(node.pk) ? node.pk : [];
    const safeColumns =
      node.columns !== null &&
      node.columns !== undefined &&
      !Array.isArray(node.columns) &&
      typeof node.columns === 'object'
        ? node.columns
        : {};
    if (safePk === node.pk && safeColumns === node.columns) return node;
    return { ...node, pk: safePk, columns: safeColumns };
  });

  const cleanedModel: Model = {
    ...model,
    nodes: cleanedNodes,
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
  flowErrors: FlowError[] = [],
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
    ...flowErrors.map(e => ({
      severity: e.severity,
      ruleId: e.ruleId,
      location: e.processId ? `${e.flowId}/${e.processId}` : e.flowId,
      message: e.message,
    })),
  ].filter(r => !RULES[r.ruleId]?.liveOnly);

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
