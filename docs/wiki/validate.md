---
type: Domain
description: Pure validation layer that checks a parsed Model against a 27-rule catalog and produces a cleaned model plus structured findings.
---

# validate

## What it does

[`src/model/validate.ts`](../../src/model/validate.ts) runs a fixed catalog of rules against a parsed `Model` (and, via `FlowError`, flow findings) and returns structured findings plus a `cleanedModel` safe for downstream rendering. It has no Node/Bun I/O — only type-only imports — so it is browser-safe and unit-testable with plain `Model` literals.

## CLI code

- [`src/model/validate.ts`](../../src/model/validate.ts) — `validateModel(model: Model): ValidationResult`, `formatFindingsForStderr(globalErrors, entityErrors, flowErrors?): string[]`, `RULES: Record<RuleId, RuleEntry>`, and the types `RuleId`, `EntityError`, `GlobalError`, `ValidationResult`, `RuleEntry`.
- `RuleId` is a union of 27 rule ids across 6 prefixes: parse (`parse.invalid_yaml`, `parse.missing_id`, `parse.empty_frontmatter`), entity (`entity.missing_pk`, `entity.missing_columns`, `entity.invalid_field_type`, `entity.unknown_group`, `entity.ak_unknown_column`, `entity.example_unknown_column`), body (`body.unknown_link`), edge (`edge.unknown_target`, `edge.dangling_fk_column`), cluster (`cluster.missing_basetype`, `cluster.missing_member`, `cluster.no_discriminator`), and flow (12 ids: `flow.unknown_store`, `flow.unknown_external`, `flow.unknown_process`, `flow.unknown_attribute`, `flow.ambiguous_endpoint`, `flow.process_no_input`, `flow.process_no_output`, `flow.illegal_connection`, `flow.process_to_process`, `flow.unbalanced_decomposition`, `flow.duplicate_number`, `flow.store_naming_collision`).
- `RULES` is `Record<RuleId, RuleEntry>` — TypeScript compile-errors if any `RuleId` is missing an entry (compiler-enforced exhaustiveness, no runtime check needed).
- `RuleEntry.class`: `'A'` = render degraded + warning triangle; `'B'` = omit + global banner. `RuleEntry.liveOnly?: boolean` — only `entity.example_unknown_column` sets this (`formatFindingsForStderr` and the static dict generator omit `liveOnly` rows; only the live viewer findings panel and `/api/model` surface them). `RuleEntry.silenceable?: boolean` — only `flow.process_to_process` sets this; it is informational for tooling, silenced via the `flow_rules: { process_to_process: false }` key in `ignatius.yml`.
- `ValidationResult = { entityErrors: EntityError[]; globalErrors: GlobalError[]; cleanedModel: Model }`. `cleanedModel` has Class-B-stripped edges (unknown target) and clusters (missing basetype, with missing members filtered out of surviving clusters), plus nodes with invalid `pk`/`columns` coerced to safe defaults (`[]` / `{}`).
- `formatFindingsForStderr` takes an optional third `flowErrors: FlowError[]` param so CLI callers can pass combined entity + flow findings in one call. It filters out `liveOnly` rows, then sorts: errors before warnings, `ruleId` alphabetical, location alphabetical within that.
- `checkAlternateKeys` implements `entity.ak_unknown_column`: an `ak` entry naming a column not in `pk`/`columns` is dropped silently at the derivation layer, which can turn a referential FK that should resolve one-to-one into a one-to-many — the rule exists to catch that before it becomes a wrong cardinality badge.

## Docs

- [`docs/design/schema-lint-and-error-ux.md`](../design/schema-lint-and-error-ux.md) — original design doc for this validation layer (rule catalog, render policy, findings panel).
- [`docs/spec/schema-lint-and-error-ux.md`](../spec/schema-lint-and-error-ux.md) — implementation spec/contract for `validateModel`, the `RULES` registry, and `cleanedModel` stripping behavior.

## Coupling

- parser ([`src/model/parse.ts`](../../src/model/parse.ts)): validate.ts type-imports `Model`, `ModelNode`, `ModelEdge`, `SubtypeCluster` from `./parse`; parse.ts type-imports `GlobalError` back from `./validate`. Both directions are `import type` only — no runtime circular dependency, but the two files' exported shapes must stay in sync.
- flows ([`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts), [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts)): validate.ts type-imports `FlowError` from `../flows/flow-validate`; flow-validate.ts type-imports `GlobalError` and `RuleId` back, and flow-parse.ts type-imports `GlobalError`. flow-validate.ts mirrors validate.ts's structure for the flow layer and implements all `flow.*` ids declared in validate.ts's `RuleId` union — adding a `flow.*` id here requires adding its implementation and `RULES` entry there (or vice versa).
- cli ([`src/cli/cli.ts`](../../src/cli/cli.ts)): dynamically imports `validateModel`, `formatFindingsForStderr`, `RULES` at two call sites; uses `RULES[ruleId].class` (not the finding's own `severity` field) as the authoritative signal for whether flow findings count toward the hard-exit error count, keeping the exit code derived from one source of truth.
- server ([`src/server/server.ts`](../../src/server/server.ts)): imports `validateModel` directly (not dynamically) to validate models served live.
- frontend ([`src/app/`](../../src/app)): `App.tsx`, `EntityCard.tsx`, `EntityModal.tsx`, `FindingsPanel.tsx`, `ProcessCard.tsx` all import `RULES` to look up rule titles for display; `App.tsx` additionally uses it to filter `liveOnly` findings out of the static-mode panel (`findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)`); `hooks/useModelData.ts` imports `validateModel` directly; `logic/finding-rows.ts` type-imports `EntityError`, `GlobalError`, `RuleId`.
- Any new `RuleId` added here must get a matching `RULES` entry (compiler-enforced) and, if consumer-facing, a title a reader of `App.tsx`/`FindingsPanel.tsx` would recognize — the registry is the single source of human-readable rule text across CLI stderr, dict, graph, and live viewer.

## Conventions worth knowing

- One predicate function per entity/edge/cluster rule (e.g. `checkMissingPk`, `checkEdgeDanglingFkColumn`, `checkClusterNoDiscriminator`), each returning an empty array when the rule is satisfied — `validateModel` just concatenates their outputs per node/edge/cluster. Exception: the two Class-B detectors, `checkEdgeUnknownTarget` and `checkClusterMissingBasetype`, return `GlobalError | null` instead of an array; `validateModel` pushes their result conditionally (`if (unknownTargetError) { ... }`) rather than spread-concatenating it.
- Class A vs Class B is encoded per-rule in the `RULES` registry, not computed ad hoc at each call site — consumers look it up rather than hardcoding which rules strip data.
- `checkMissingColumns` treats `columns` as violating the rule only when missing/empty; `parse.ts` already defaults a missing `columns` field to `{}`, so in practice only the empty-object case fires.
