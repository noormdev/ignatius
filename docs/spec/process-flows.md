# SSADM process flows — implementation contract


Derived from `docs/design/process-flows.md`.


## Goal


Add SSADM data flow diagrams to ignatius: file-per-process markdown authoring, shared `db:` store resolution against the entity catalog, well-formedness validation riding the existing `flow.*` rule registry, and Cytoscape rendering via a separate flow render path in the existing bundle. **Flows are a first-class surface, consistent with `graph`/`dict`/`validate`:** `flow [path]` is path-first (a DFD is in-app navigation, not a CLI argument — a model has many DFDs the way the ERD has many entities), and `serve` exposes flows as a live, hot-reloading surface alongside the ERD and dict.


## Non-goals


- Hard balancing *enforcement* — decomposition mismatch is a soft warning only (the comparison is data-level, but it never blocks).
- The current-physical → logical → required SSADM progression and logicalisation.
- Schema validation on non-`db:` stores (cache/queue/file/doc/manual have no schema here; `_stores/<name>.md` adds an optional *description*, not a schema).
- Queue/message payload shape validation — non-`db:` flows carry opaque labels in v1; validating a `queue:` payload against a declared shape is out of scope.
- Auto-promotion of discovered attributes into entities — `flow.unknown_attribute` surfaces a gap; closing it (editing the entity) is the author's job, not the tool's.
- Perfect auto-layout — drag-to-save covers the gap.
- LDS (already the ERD) and ELH — out of scope.
- A second compiled bundle for the flow viewer (v1 renders flow via a separate render path inside the existing bundle).
- Validation of `examples:` tokens against the process's declared `inputs`/`outputs` — example token cross-validation (`flow.example_unknown_*`) is deferred; examples render as authored without checking that `from`/`to` tokens match real endpoints.


## Resolved decisions


- **`db:` flow data is always checked.** On a `db:` endpoint, `data` is always columns — a string is one column, an array is several — and every column is validated against the entity. The YAML type (`string` vs `string[]`) carries no meaning on a `db:` endpoint; the endpoint *kind* decides. A string is an opaque label only on a non-`db:` endpoint (`ext:`, `cache:`, `queue:`, `file:`, `doc:`, `manual:`), where there is no schema to check.
- **Non-`db:` stores are inline-by-first-use, optionally described.** A `cache:Sessions` store exists because something references it — the `kind:name` pair is the declaration; no file is required. An optional `_stores/<name>.md` file (parallel to `_externals/<name>.md`) attaches a `kind:` + narrative body to a non-`db:` store when the author wants to describe it.
- **Full-tree decomposition.** A process file paired with a same-named folder is its sub-DFD; that folder's processes may themselves pair with same-named folders, recursively, to the leaves. Every process box is drillable into its own DFD. Decomposition is not capped at one level.
- **Balancing is data-level, at every seam.** At each process/sub-DFD boundary, the *columns* crossing out of the children (excluding sibling-to-sibling internal flows) must equal the columns on the parent process's own inputs/outputs, compared as a set of columns per outside connection. Checked at every boundary down the tree, not just the top.
- **Process numbering is local-authored, tree-composed.** Each process declares a single local `number:` (its rank among its siblings). When `number:` is absent, the local rank falls back to the process's folder-order position among its siblings (so a diagram with no authored numbers still composes). The tool composes the full dotted SSADM number (`1.2.1`) by walking the folder path. The dotted prefix is derived, so it cannot be authored wrong; validation guards only sibling-local uniqueness (`flow.duplicate_number`), which fires only on authored collisions — folder-order fallbacks are distinct by construction.
- **One bundle, separate render paths.** The flow viewer reuses the existing compiled bundle but has its own stylesheet builder and its own `initFlowGraph` entry — it does not append selectors to the ERD's `buildStyles`. ERD render code is untouched.
- **Separate position storage per surface.** Flow position persistence uses a `localStorage` key distinct from the ERD's, so opening flow diagrams never evicts saved ERD layouts (and vice versa).
- **`manual:` / `M` store kind is IN for v1.** All six non-`db:` kinds (cache, queue, file, doc, manual, plus `db:` = 7 total) are supported.
- **`__IGNATIUS_SURFACE__` over a third `__IGNATIUS_MODE__` value.** A separate surface discriminator was chosen to leave all existing `=== 'static'` / `=== 'live'` checks in `App.tsx` and `src/index.html` untouched.


## Success criteria


- `ignatius flow <model-path> -o flow.html` (path-first, no DFD name — identical arg shape to `dict`/`graph`) writes one viewer carrying ALL the model's DFDs and exits 0 (exits 1 when any global error or Class B flow finding is present, across any DFD — consistent with `dict`/`graph`); `-o` is required (error + exit 1 when omitted, like `dict`/`graph`); a model with no `flows/` prints a friendly note and exits 0. The viewer renders the canonical DFD node shapes in Gane-Sarson notation (process = numbered rounded-rect hub, external = green rectangle, store = open-ended `D#` rectangle) via the custom SVG flow renderer, and — when the model has more than one DFD — a DFD selector that swaps diagrams client-side.
- `ignatius serve <model-path>` serves the flow viewer at `/flow`, the flow dictionary at `/flow-dict`, and `/api/flow`; the graph/dict/flow FABs cross-link all three live surfaces; editing a flow `.md` hot-reloads the flow viewer via the existing SSE `model-changed` event.
- `ignatius validate models/shop` reports `flow.*` findings on stderr and exits non-zero when any Class B flow rule fires.
- `bun src/cli/cli.ts flow models/key-inherited` reads naturally as path-first (no "DFD 'models/key-inherited' not found" error); the `order-to-cash` demo DFD in `models/key-inherited` renders, navigable, with 0 findings.
- A `db:` flow naming a column the entity lacks emits exactly one `flow.unknown_attribute` (Class A) finding for that process, visible in CLI stderr, the dict findings panel, and the graph findings panel. This fires whether the column was authored as a string (single column) or inside an array (multiple columns) — a string on a `db:` endpoint is a column, not a label.
- `parseFlows(dir)` excludes `flows/**` from entity discovery — `bun test/checks/test-parse-flows.ts` confirms no flow process file appears as a `ModelNode`.
- `validateFlows` emits `flow.unknown_store` (Class B) when a `db:` endpoint names an entity id absent from the entity catalog; the corresponding flow edge is absent from `cleanedFlowModel`.
- `validateFlows` emits `flow.illegal_connection` (Class B) when a store-to-store, ext-to-store, or ext-to-ext direct edge is authored.
- `validateFlows` emits `flow.process_to_process` (Class A) for direct process→process flows by default; the finding is silenceable via a `flow_rules.process_to_process: false` key in `ignatius.yml`.
- `validateFlows` emits `flow.ambiguous_endpoint` (Class A) when a bare endpoint name collides across namespaces; no guess is made.
- `validateFlows` emits `flow.duplicate_number` (Class A) when two sibling processes in the same diagram declare the same local `number:`.
- A non-`db:` store with an optional `_stores/<name>.md` file carries that file's rendered body on its `FlowStoreRef`; a non-`db:` store without one still resolves (inline-by-first-use) and renders with no body.
- Decomposition recurses to the leaves: `Authenticate/Login/CreateSession` is parsed as three nested levels; the flow viewer renders a drill-down affordance on every parent process at every level, not just the top.
- Numbering composes from the tree: a process with local `number: 2` sitting under a parent that composes to `1` renders as `1.2`; its child with local `number: 1` renders as `1.2.1`.
- `flow.unbalanced_decomposition` (Class A) fires when the set of columns crossing a sub-DFD's boundary differs from the columns on the parent process's inputs/outputs, at any level of the tree; it does not fire when the column sets match. Sibling-to-sibling internal flows are excluded from the boundary set.
- `layoutFlowFingerprint(diagram: FlowDiagram): string` changes when a flow node or flow edge is added or removed; it does not change when only a process body, label, local number, or `data` (in either string or array form) changes.
- Flow position persistence reads and writes a `localStorage` key distinct from the ERD's `ignatius-layout-positions`; a check confirms saving flow positions never mutates the ERD key.
- `bun run typecheck` passes with no new errors after each checkpoint.
- `bun run test` passes after each checkpoint (including any new `test/checks/test-flow-*.ts` scripts).


## Checkpoints


**CP-1 through CP-8 are SHIPPED** (squashed onto `main` — the parse/validate/render/fingerprint/persistence/drill-down engine). They are retained below as the historical build record. The **active build plan is the Rework checkpoints (CP-R1–R3)** below this table — the consistency + serve-integration work.

### Shipped checkpoints (historical — do not re-build)

| # | Checkpoint | Files / areas | Agent | Est. files | Verifies |
|---|------------|---------------|-------|-----------|----------|
| 1 | `FlowModel` types + `parseFlows` + recursive folder discovery + `_externals/` + optional `_stores/` + local→dotted numbering + entity-file exclusion | `src/flow-parse.ts` (new), `src/parse.ts` (path exclusion), `test/checks/test-parse-flows.ts` (new), `test/fixtures/flows/` (new) | atomic-builder | 4 | `parseFlows` returns `FlowModel` with processes, externals, flow edges, store refs; same-named folders nest recursively to leaves; optional `_stores/<name>.md` body attaches to its `FlowStoreRef`; `dottedNumber` composes from local `number:` along the folder path; no flow process file appears in `parseModels` entity nodes; typecheck clean |
| 2 | `validateFlows` + all 11 `flow.*` rules in `RULES` registry | `src/validate.ts` (extend), `src/flow-validate.ts` (new), `test/checks/test-validate-flows.ts` (new), `test/fixtures/broken-flow/` (new) | atomic-builder | 5 | All 11 `flow.*` rules fire on the broken fixture; all are absent on a clean fixture; `RULES` compiles (Record completeness enforced by TypeScript); Class B rules strip edges from `cleanedFlowModel`; `flow.unknown_attribute` fires on both string and array `data` on a `db:` endpoint |
| 3 | Endpoint resolution + ambiguity | `src/flow-parse.ts` (resolution logic), `test/checks/test-flow-endpoints.ts` (new) | atomic-builder | 2 | Bare name resolves when unique across three namespaces; collision emits `flow.ambiguous_endpoint`; qualified names (`ext:`, `db:`, `proc:`, `cache:`, …) always resolve without ambiguity check; unknown qualified `db:` endpoint emits `flow.unknown_store`; unknown qualified `ext:` emits `flow.unknown_external` |
| 4a | `generateFlowGraph` static HTML injection *(injection partly superseded by R1: single `__FLOW_LAYOUT_KEY__` → `__FLOW_LAYOUT_KEYS__` map; single diagram → `FlowModel`)* | `src/generators/flow-graph.ts` (new) | atomic-builder | 1 | Static `flow-<name>.html` is written with correct `window.__IGNATIUS_SURFACE__`, `window.__FLOW_MODEL__`, `window.__FLOW_LAYOUT_KEY__`, `window.__IGNATIUS_MODE__ = "static"`; no App.tsx change; verifiable by parsing the emitted script tags |
| 4b | App.tsx flow render path — `initFlowGraph` + separate flow stylesheet + DFD shapes | `src/App.tsx` (flow render path via `initFlowGraph` + own stylesheet builder), `test/visual/screenshot-flow-graph.ts` (new) | atomic-builder | 2 | Static `flow.html` renders: external = rectangle, process = rounded rectangle with composed-number badge, db-store = barrel shape, generic store = cut-rectangle; flow shapes come from a dedicated flow stylesheet builder, NOT appended to the ERD `buildStyles`; ERD selectors untouched; Playwright screenshot taken and inspected |
| 5 | `ignatius flow` CLI subcommand + `validate` integration *(CLI shape superseded by R2: `flow <name>` → path-first `flow [path] -o`; the `validate` integration here still stands)* | `src/cli.ts` (new `flowCmd`, register in `main`), `src/flow-validate.ts` (consumed by validate cmd), `test/checks/test-flow-cli.ts` (new) | atomic-builder | 3 | `ignatius flow <name> [path]` writes `flow-<name>.html` and exits 0 (exits 1 on Class B findings); `ignatius validate` includes flow findings in stderr and exit code; a missing/unknown DFD name exits 1 with a message |
| 6 | `generateFlowDict` process dictionary | `src/generators/flow-dict.ts` (new), `test/checks/test-flow-dict.ts` (new) | atomic-builder | 3 | Static `flow-dict-<name>.html` lists each process with its inputs/outputs table, attribute list for `db:` flows, optional `_stores/` description for generic stores, body narrative, and findings panel; layout mirrors `generateDict` structure |
| 7 | Leveling: recursive client-side drill-down + data-level `flow.unbalanced_decomposition` | `src/flow-validate.ts` (recursive decomposition rule + harden the boundary picker), `src/App.tsx` (`initFlowGraph` client-side sub-DFD swap + back affordance), `test/checks/test-flow-leveling.ts` (new) | atomic-builder | 4 | `flow.unbalanced_decomposition` fires when the boundary *column* sets differ at ANY seam down the tree and is silent when they match (sibling-internal flows excluded); a process with `hasSubDfd` renders a drill affordance that swaps the rendered diagram to its sub-DFD client-side, with a back affordance |
| 8 | Flow layout fingerprint + drag-save reuse with separate storage key *(injection superseded by R1: single `__FLOW_LAYOUT_KEY__` → `__FLOW_LAYOUT_KEYS__` map; the fingerprint fn + separate-key persistence still stand)* | `src/flow-fingerprint.ts` (new), `src/generators/flow-graph.ts` (inject `__FLOW_LAYOUT_KEY__`), `src/App.tsx` (flow-mode store integration under a distinct key), `test/checks/test-flow-fingerprint.ts` (new) | atomic-builder | 4 | `layoutFlowFingerprint` is topology-only (node ids + edge source>target pairs); changes on structural edits, stable on label/body/column-list/local-number edits; static HTML carries `window.__FLOW_LAYOUT_KEY__`; saved positions restore on reload; flow positions persist under a `localStorage` key distinct from the ERD's |


### Rework checkpoints (consistency + serve) — ACTIVE


| # | Checkpoint | Files / areas | Agent | Est. files | Verifies |
|---|------------|---------------|-------|-----------|----------|
| R1 | Render-all + in-app DFD navigation | `src/generators/flow-graph.ts` (take `FlowModel`, inject all diagrams + `__FLOW_LAYOUT_KEYS__` map), `src/App.tsx` (`initFlowGraph` reads the diagram array, renders a DFD selector when >1, swaps via the existing `renderDiagram`; per-diagram persistence from the key map), `test/checks/test-flow-graph-gen.ts` (update), `test/visual/screenshot-flow-graph.ts` (update) | atomic-builder | 4 | `generateFlowGraph(flowModel,…)` injects `__FLOW_MODEL__` as the diagram array + `__FLOW_LAYOUT_KEYS__`; a multi-DFD model renders a selector and swaps between top-level DFDs client-side; a single-DFD model renders directly; positions persist per navigated diagram; ERD untouched |
| R2 | `flow` CLI → path-first, render-all, `-o` required; flow-dict reachable | `src/cli.ts` (`flowCmd` drops the `<name>` positional, mirrors `dictCmd`/`graphCmd` exactly; emits the flow viewer + a reachable process dictionary), `test/checks/test-flow-cli.ts` (rewrite) | atomic-builder | 2 | `flow [path] -o f.html` exits 0 on a clean model and writes one viewer with all DFDs; `-o` omitted → stderr error + exit 1; Class B finding → exit 1; no-`flows/` model → friendly note + exit 0; `flow models/key-inherited` is parsed path-first (no DFD-name error); the process dictionary is reachable from the export |
| R3 | `serve` live flow surface + FAB nav + hot-reload | `src/server.ts` (`/flow`, `/api/flow`, `/flow-dict` routes), `src/App.tsx` (`initFlowGraph` live branch: fetch `/api/flow`, re-fetch on SSE `model-changed`), `src/generators/dict.ts` + graph FAB (add a **Flows** nav item cross-linking `/`, `/dict`, `/flow`), `test/checks/test-flow-serve.ts` (new) | atomic-builder | 4 | `GET /flow` returns the live viewer (`__IGNATIUS_SURFACE__='flow'`); `GET /api/flow` returns `{diagrams, validation, flowLayoutKeys}`; `GET /flow-dict` returns the dictionary; editing a flow `.md` triggers SSE `model-changed` and the live viewer re-fetches; FABs on all three surfaces cross-link; no-`flows/` model → empty-state, not 500 |


## Module: `src/flow-parse.ts`


New module, no Node I/O beyond `Bun.file` / `Bun.Glob`. Pure output is `FlowParseResult`. Browser-safe except for file I/O (not bundled into the React bundle — only called from `src/cli.ts` and `src/server.ts`).

**Types exported:**

```
FlowEndpoint = {
  kind: 'ext' | 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual' | 'proc';
  name: string;           // resolved id
  raw: string;            // original authored string, for error messages
}

FlowData = string | string[]
  // On a db: endpoint, ALWAYS columns: string = one column, string[] = several — all validated.
  // On a non-db endpoint, an opaque label (string or list of labels), never column-checked.

FlowEdge = {
  from: FlowEndpoint;
  to: FlowEndpoint;
  data: FlowData;
  flowId: string;         // parent DFD id
}

FlowExampleRow = Record<string, string | number | boolean>
  // One row of sample data. Values are plain scalars (no nested objects).

FlowExample = {
  from?: string;          // source token for in-flows (e.g. "ext:Customer")
  to?: string;            // destination token for out-flows (e.g. "db:Payment")
  label?: string;         // human label for the flow (mirrors the inputs/outputs data label)
  rows: FlowExampleRow[]; // sample rows rendered as a table
}

FlowProcess = {
  id: string;             // PascalCase filename without .md
  label: string;          // `process:` frontmatter value
  number?: number;        // local rank among siblings (authored); falls back to folder order if absent
  dottedNumber: string;   // composed full SSADM number (e.g. "1.2.1"), derived from the folder path
  inputs: FlowEdge[];
  outputs: FlowEdge[];
  body: string;           // raw markdown
  bodyHtml: string;       // rendered HTML (same md instance as parse.ts)
  hasSubDfd: boolean;     // true when a same-named folder exists alongside the file
  flowId: string;
  examples?: {            // optional in/out data examples for the process dialog
    in: FlowExample[];    // one entry per annotated input flow
    out: FlowExample[];   // one entry per annotated output flow
  };
}

FlowExternal = {
  id: string;
  label: string;          // `external:` frontmatter value
  body: string;
  bodyHtml: string;
  flowId: string;
}

FlowStoreRef = {
  kind: 'db' | 'cache' | 'queue' | 'file' | 'doc' | 'manual';
  name: string;           // resolved id
  body?: string;          // raw markdown from optional _stores/<name>.md (non-db only)
  bodyHtml?: string;      // rendered HTML from optional _stores/<name>.md
  flowId: string;
}

FlowDiagram = {
  id: string;             // folder name under flows/
  processes: FlowProcess[];
  externals: FlowExternal[];
  storeRefs: FlowStoreRef[];   // deduplicated store appearances
  edges: FlowEdge[];
  subDfds: FlowDiagram[];      // recursive to the leaves — a sub-DFD may have its own sub-DFDs
}

FlowModel = {
  diagrams: FlowDiagram[];
  modelDir: string;
}

FlowParseResult = {
  flowModel: FlowModel;
  globalErrors: GlobalError[];   // reuses GlobalError from src/validate.ts
}
```

**Functions exported:**

- `parseFlows(modelDir: string): Promise<FlowParseResult>` — discovers `flows/*/` under `modelDir`; reads each DFD folder recursively (a process file plus a same-named folder is a sub-DFD, and that recursion continues to the leaves); tracks the visited folder path during recursion and refuses to re-enter an ancestor, so a malformed/cyclic folder structure cannot loop the parser; reads optional `_externals/*.md` and `_stores/*.md` description files; composes each process's `dottedNumber` from its local `number:` (or folder-order fallback) along the nesting path; builds `FlowModel`. Errors in individual files are caught per-file and appended to `globalErrors` with `parse.*` ruleIds (same posture as `parseModels`).
- `resolveEndpoint(raw: string, context: EndpointContext): FlowEndpoint | null` — pure; splits on `:` prefix to determine `kind`; when prefix absent, checks uniqueness across all namespaces in context. Returns `null` on ambiguity or total absence (caller records the appropriate `flow.*` finding). Resolution compares against the resolved `kind:name` form — spelling variants that resolve to the same `kind:name` pair are treated identically.

**Frontmatter contract for process files:**

```yaml
process: <human label>        # required
number: 2                     # optional local rank among siblings; folder order if absent
inputs:
  - from: <endpoint>
    data: [creditLimit]       # db: endpoint → always columns (a string here = one column)
outputs:
  - to: <endpoint>
    data: confirmation        # non-db endpoint → opaque label
examples:                     # optional in/out data examples rendered as tables in the process dialog
  in:
    - from: ext:Customer      # source token (mirrors an inputs: from: value)
      label: payment details  # flow label
      rows:
        - { card: "****4242", amount: 49.99 }   # free-form key→scalar objects
  out:
    - to: db:Payment          # destination token (mirrors an outputs: to: value)
      label: settled txn
      rows:
        - { id: 9001, status: captured }
```

**Process `examples:` rendering contract:** in the process dialog (`FlowNodeModal`), after the markdown body and the existing IO table, render one `<details class="modal-examples">` per `in` entry and one per `out` entry. Table caption = direction (`in`/`out`) + counterpart token + label, joined with ` · `. Columns = union of keys across all rows in that entry; blank cell (`–`) when a row lacks a key. When `examples:` is absent the section is not rendered — no empty header. Validation of example tokens against the process's declared inputs/outputs is out of scope (non-goal, see below).

**Frontmatter contract for external files (`_externals/*.md`):**

```yaml
external: <human label>       # required
```

**Shared externals at `flows/_externals/`.** An external can be declared once at
the flows root (`flows/_externals/<Name>.md`) and referenced by any DFD at any
nesting depth — the parser passes the root externals down the recursion and
merges into each diagram only the ones that diagram actually references
(`ext:Name` in an edge). A DFD's own `_externals/<Name>.md` overrides the root
definition for that DFD. This removes the need to re-describe a recurring actor
(e.g. `Customer`) in every DFD folder; document everything it does once, at root.
`readExternalsDir` reads both the root and per-DFD folders; `parseFlows` skips
`_`-prefixed entries under `flows/` so `_externals/` is not parsed as a DFD.

**Frontmatter contract for optional store description files (`_stores/*.md`):**

```yaml
kind: cache                   # one of: cache | queue | file | doc | manual | other (db: stores are entities, described in their own .md)
```

The file name (without `.md`) is the store name; the body is the store's narrative. Authoring a `_stores/` file is never required — a non-`db:` store that is referenced but undescribed still resolves inline-by-first-use.

**Entity-file exclusion in `src/parse.ts` (extension, not rewrite):** Entity discovery at `src/parse.ts:215–320` must skip any file whose path resolves under `<modelDir>/flows/`. The behavioral contract: entity discovery skips any file under `<modelDir>/flows/`.


## Validator: `src/validate.ts` + `src/flow-validate.ts`


**`src/validate.ts` — extend only:**

- `RuleId` union (currently 14 rules at `src/validate.ts:20–41`) gains 11 new members:
  `'flow.unknown_store' | 'flow.unknown_external' | 'flow.unknown_process' | 'flow.unknown_attribute' | 'flow.ambiguous_endpoint' | 'flow.process_no_input' | 'flow.process_no_output' | 'flow.illegal_connection' | 'flow.process_to_process' | 'flow.unbalanced_decomposition' | 'flow.duplicate_number'`
- `RuleEntry` type at `src/validate.ts:75–87` gains an optional `silenceable?: boolean` field. Only `flow.process_to_process` sets it `true`; all other rules omit the field (implicitly `false`).
- `RULES` record at `src/validate.ts:93–170` gains one entry per new `RuleId`. TypeScript compile-errors if any entry is missing.
- Rule classifications:
  - Class B (omit): `flow.unknown_store`, `flow.unknown_external`, `flow.unknown_process`, `flow.illegal_connection`
  - Class A (warn): `flow.unknown_attribute`, `flow.ambiguous_endpoint`, `flow.process_no_input`, `flow.process_no_output`, `flow.process_to_process`, `flow.unbalanced_decomposition`, `flow.duplicate_number`
- `flow.process_to_process` entry: `class: 'A'`, `silenceable: true`. When `ignatius.yml` carries `flow_rules: { process_to_process: false }`, `validateFlows` skips that check. The `silenceable` field is informational for tooling; the config key is the enforcement mechanism.

**`FlowRulesConfig` seam:** `ignatius.yml`'s `flow_rules:` block is loaded by `parseModels` (alongside theme/branding) into `Model._meta` (extend `_meta` to carry it as `flowRules?: FlowRulesConfig`). `validateFlows` reads it from `Model._meta.flowRules` — it does not re-read `ignatius.yml`.

**`src/flow-validate.ts` — new module:**

Exports:

- `validateFlows(flowModel: FlowModel, entityModel: Model, config?: FlowRulesConfig): FlowValidationResult`
- `FlowValidationResult = { flowErrors: FlowError[]; globalErrors: GlobalError[]; cleanedFlowModel: FlowModel }`
- `FlowError = { ruleId: RuleId; flowId: string; processId?: string; severity: 'warning' | 'error'; message: string }`
  — Flow findings are scoped to a DFD + process (`flowId`, `processId?`), not an ERD entity, so `FlowError` is a distinct type rather than overloading `EntityError`.
- `FlowRulesConfig = { process_to_process?: boolean }` — mirrors the `flow_rules:` block from `ignatius.yml`

Rule implementations (all pure, no I/O):

- `flow.unknown_store` — a `db:` store ref whose `name` is not found in `entityModel.nodes`. Non-`db:` stores are opaque and inline-by-first-use (a store is declared by being referenced with the same `kind:name` in any process, or by an optional `_stores/` file); they are exempt from existence checking. Class B → strip all flow edges touching the unknown `db:` store from `cleanedFlowModel`.
- `flow.unknown_external` — `ext:Name` not found in the DFD's `FlowExternal[]`. Class B → strip edges.
- `flow.unknown_process` — `proc:Name` not found in the DFD's `FlowProcess[]`. Class B → strip edges.
- `flow.unknown_attribute` — a `db:` `FlowEdge` whose `data` (whether a single string or an array) names a column absent from the entity's `pk` (as string names) and `columns` (as keys). On a `db:` endpoint `data` is always columns: a string is one column, an array is several, and each is checked. A string on a non-`db:` endpoint is an opaque label and is never reached by this rule. Class A — process stays in `cleanedFlowModel`, finding recorded.
- `flow.ambiguous_endpoint` — `resolveEndpoint` returned `null` due to collision; the bare name exists in more than one namespace. Class A.
- `flow.process_no_input` / `flow.process_no_output` — process has zero input / zero output edges after Class B stripping. Class A.
- `flow.illegal_connection` — a `FlowEdge` where neither endpoint is a process (`kind !== 'proc'`). Covers store↔store, ext↔store, ext↔ext. Class B → strip edge.
- `flow.process_to_process` — a `FlowEdge` where both endpoints have `kind === 'proc'`. Class A, skipped when `config.process_to_process === false`.
- `flow.duplicate_number` — within a single `FlowDiagram`, two sibling `FlowProcess` declare the same local `number:`. Fires on authored collisions only; folder-order fallback values are distinct by construction and never collide. Class A — does not strip anything. The composed `dottedNumber` is derived from the folder tree and cannot be authored wrong, so this is the only number-consistency check needed.
- `flow.unbalanced_decomposition` — for each process where `hasSubDfd === true`, recursively at every level: compute the set of *columns* crossing the sub-DFD's boundary — for each edge whose from/to references a non-process endpoint outside the sub-DFD, the `(resolved endpoint, column)` pairs, with sibling-to-sibling internal flows excluded — and compare it against the columns on the parent process's `inputs` + `outputs` for the same outside connections. A non-empty set difference fires the rule. Comparison is column-level (the data crossing the edge), keyed on resolved `FlowEndpoint.name`, not raw authored strings. Class A, soft — does not strip anything.

`formatFindingsForStderr` at `src/validate.ts:508–547` is extended to accept an optional third parameter:

```ts
formatFindingsForStderr(
  globalErrors: GlobalError[],
  entityErrors: EntityError[],
  flowErrors: FlowError[] = []
): string[]
```

The `= []` default ensures all existing callers compile unchanged. Sort order: errors before warnings, ruleId alphabetical within severity, location alphabetical within ruleId.


## CLI: `src/cli.ts`


**`flow` is path-first and identical in shape to `dict`/`graph`/`validate`. A DFD is NOT a CLI argument — it is in-app navigation (a model has many DFDs the way the ERD has many entities; you don't pass `--entity` to `graph`).**

- `flowCmd = defineCommand(...)` mirrors `dictCmd`/`graphCmd` *exactly*:
  - Optional positional `[path]` — model search base (default cwd). This is the ONLY positional. There is no `<name>` positional.
  - `-o` / `--out <file>` — output path, **required** (same as `dict`/`graph`: error to stderr + exit 1 when omitted).
  - `--model <key>` — model picker key.
  - `--theme light|dark`.
  - Pipeline: `pickModel(base, modelKey)` → `parseModels(dir)` (entity catalog) → `parseFlows(dir)` → `validateFlows(flowModel, model, config)` → `formatFindingsForStderr(...)` to stderr → `generateFlowGraph(flowModel, …)` (the WHOLE model — all DFDs) → `Bun.write(outputPath, html)` → exit.
  - Exit code 1 when **any global error is present OR any Class B flow finding is present** — consistent with `dict`/`graph`, which exit 1 on global errors. Global errors include parse-time errors and entity/flow validation global errors. Class A flow warnings do not affect the exit code. Else 0.
  - A model with **no `flows/`** dir: print a friendly stderr note (`no flows in <model>`) and exit 0 — not an error (mirrors how `dict` handles an empty model gracefully).
- The output is ONE self-contained viewer carrying every DFD in the model; selecting a DFD is in-app navigation (see Render). No per-DFD output files; no DFD-name argument anywhere.
- `validateCmd` already calls `parseFlows` + `validateFlows` when a `flows/` dir exists and merges flow findings into stderr + exit code — unchanged by this rework.
- `config` for `FlowRulesConfig` is read from `Model._meta.flowRules`.

**Superseded:** the previous `flow <name> [path]` (required DFD-name positional, `--out` defaulting to `flow-<name>.html`, exit 1 on unknown name) is removed. The name-first shape broke the path-first convention every other verb follows; `flow models/x` now reads the same as `graph models/x`.


## Render: `src/generators/flow-graph.ts` + `src/App.tsx`


**`src/generators/flow-graph.ts`:**

Signature: `generateFlowGraph(flowModel, entityModel, mode, opts, sourceOrDir?): Promise<string>` — async, returning the HTML string. **It serializes the WHOLE `FlowModel` (every top-level DFD), not a single diagram**, so one viewer carries all of a model's flows. `sourceOrDir` mirrors `generateGraph`'s DI bundle source (defaults to the embedded bundle). Parameters: `flowModel: FlowModel`, `entityModel: Model`, `mode: 'static' | 'live'`, `opts: FlowGraphOpts`.

Where `FlowGraphOpts = { flowLayoutKeys: Record<string, string>; themeMode?: 'dark' | 'light' }` — `flowLayoutKeys` maps each diagram id (top-level and, where persisted, sub-DFD) to its `layoutFlowFingerprint`, so the frontend can persist positions per navigated diagram without importing the fingerprint module.

- Injects `window.__IGNATIUS_MODE__`, `window.__FLOW_MODEL__` (the serialized `FlowModel.diagrams` array), `window.__FLOW_LAYOUT_KEYS__` (the id→fingerprint map), `window.__THEME_MODE__`, and `window.__IGNATIUS_SURFACE__ = "flow"`.
- Strips the live-mode `window.__IGNATIUS_MODE__ = 'live'` inline body script.
- Escapes `</script>` in the serialized JSON.
- Reuses the existing embedded React bundle — no second bundle.

**Superseded:** `generateFlowGraph(flowDiagram, …)` taking a single `FlowDiagram` + `window.__FLOW_LAYOUT_KEY__` (one key). Now takes the `FlowModel` + a key map so the viewer holds all DFDs.

**`src/App.tsx` — flow render path (`initFlowGraph` + dedicated flow stylesheet):**

Extension points: mode dispatch at `src/App.tsx:1067–1119`, elements construction at `src/App.tsx:1257–1345`, styles at `src/App.tsx:340–483`.

- On startup, read `window.__IGNATIUS_SURFACE__`. When `=== 'flow'`, call `initFlowGraph`; otherwise call the existing ERD path unchanged. `src/index.html` carries `window.__IGNATIUS_SURFACE__ = 'erd'` as a default alongside the existing `window.__IGNATIUS_MODE__ = 'live'` so the live ERD reads a defined surface. The live `/flow` route (path-free — no DFD name) sets `__IGNATIUS_SURFACE__ = 'flow'` in the HTML it returns so the surface is defined before the bundle executes and the `/api/flow` fetch has the correct surface context.
- `initFlowGraph` — flow Cytoscape setup is isolated in this extracted function, not interleaved with the existing ERD `useEffect`. **Static mode:** reads `window.__FLOW_MODEL__` (the array of all top-level DFDs). **Live mode:** fetches `/api/flow` once, then re-fetches on every SSE `model-changed` event and re-renders the current DFD in place (the watcher already covers `flows/**`). The surface dispatch reads `window.__IGNATIUS_SURFACE__ === 'flow'` as before.
- **Top-level DFD navigation (the consistency rework).** A model has many DFDs. When more than one top-level diagram is present, `initFlowGraph` renders a DFD selector (a list/index affordance — e.g. the breadcrumb root or a FAB menu) and renders one diagram at a time; choosing another swaps the rendered diagram, **reusing the same client-side `renderDiagram` swap the drill-down already uses**. A single-DFD model renders that one directly with no picker. Selecting a DFD is navigation, exactly as selecting an entity is in the ERD — there is no DFD argument upstream of the viewer.
- Flow elements construction (inside `initFlowGraph`): map `FlowProcess` → Cytoscape nodes (label carries the composed `dottedNumber` badge); `FlowExternal` → Cytoscape nodes; `db:` store refs → Cytoscape nodes; non-db store refs → Cytoscape nodes; `FlowEdge` → directed Cytoscape edges with the flow label or column list as edge label.
- **The flow viewer is a purpose-built DFD render, not the ERD harness reskinned. The visual target is the approved design mock `tmp/mock-e.html` — match it.** Flow styles live in a dedicated flow stylesheet builder, separate from the ERD `buildStyles`; ERD render code is untouched.
- **Gane-Sarson notation (supersedes the barrel/cut-rectangle approximations):** process = numbered rounded-rect hub; external = green rectangle; data store = **open-ended rectangle** (left cap-bar with `D#` + name, open right edge) rendered via a custom SVG (e.g. Cytoscape `background-image` data-URI per node kind), NOT a built-in `barrel`. **All data flows render as a single uniform solid arrow** — read vs write is conveyed by arrow direction (store→process reads, process→store writes), per canonical SSADM/Gane-Sarson notation, NOT by line style or colour. Flow labels carry the **data** (column list / data-packet noun), never events or predicates.
- **DFD banded auto-layout (supersedes ELK-layered):** a custom layout, NOT ELK. Processes sit side by side in a row; each process's input entities/stores go above it (arrows down in), outputs below it (arrows down out). **No process-to-process edges** (the data model already forbids them). Positions are computed then fed to Cytoscape as a `preset` layout, then handed to drag-to-arrange with per-diagram persistence (same as the ERD drag-save).
- **Duplicated stores (a store both read and written is drawn twice):** when a store is written by some process *and* read by another (or the same one), it is emitted as two copies — a **read copy** in the input band (above its readers) and a **write copy** in the output band (below its writers) — instead of a single node bridged between processes. Both copies carry the same `D#` and are marked with a thicker left border (the duplicate-store marker), painted so the `D#` cap keeps the same fixed width as a single store's. This keeps every read a short downward arrow and every write a short downward arrow, with no edge routing up and over. Mirrors the existing external split (a source/sink external is likewise drawn twice). Implemented in `flow-layout.ts` (`StoreSplitMap`, `--read`/`--write` node ids banded by suffix).
- **Edge labels (data chips):** a flow's data label lists its columns **one per line** (newline-separated, not comma-joined). Chips ride the **middle** of their edge (clear of the arrowheads), biased to the store/external end's x. Rendering is layered: all edge **paths** draw under the nodes, all **chips** draw above everything, so a line never covers a label. A de-overlap pass nudges each chip vertically to the nearest slot clear of node boxes and other chips.
- **Stores dodge the external column.** When a process has a source external above it, its **input** stores are offset off the centre column (`-1, +1, -2, +2 …` slots) so the external drops straight down. The same applies symmetrically to **output** stores when the process has a sink external below it — so the process's edge to that external drops straight through instead of looping around a stacked output store. Processes with no external on that side keep the centred placement.
- **Externals: one shared copy or per-partner copies (position-aware).** An external is drawn once when its partner processes cluster, but split into a local copy per partner when they're spread far apart (beyond `EXT_FAR_THRESHOLD` from the partner centroid) — so an external talking to processes across the diagram becomes several short local edges instead of one long crossing span. Source copies sit above their readers, sink copies below their writers; `computeFlowLayout` positions externals directly at their partners' x (not in an evenly-spaced row).
- **Hover focus + drag highlight.** Hovering a node, line, or label dims everything outside the hovered element's connected set to `0.3` opacity (the hovered item, its edges, those edges' endpoint nodes, and their labels stay at full opacity). Hovering a process highlights it plus all its edges/labels/connected nodes; hovering a store highlights it plus its edge, label, and the process. Thin lines carry a transparent wide hit-stroke so they're hoverable. While a label is being dragged, its edge line (and arrowhead) render in a bright highlight colour — themeable via the `--flow-edge-highlight` CSS custom property.
- **Draggable labels (slide along the path):** a data-label chip can be dragged; it stays locked onto its edge and slides to the nearest point along the path (pointer is projected onto the edge polyline). The placement persists per-diagram under a `chip:<edgeId>` key in the same layout store as node positions (drag-saved, reloaded, cleared by "Reset layout"). A user-placed label is exempt from the auto de-overlap pass; on a node move its saved point re-projects onto the re-routed path so it stays on its line.
- **Lines pass behind nodes (no obstacle routing):** edges are plain orthogonal trunks. A line that crosses a node simply runs behind it — paths render under the nodes, labels on top — which is legible now that the layout keeps nodes in their own columns. There is deliberately no detour-around-node routing: it produced worse "loop" artifacts at node edges than a clean line passing behind.
- **Process connection-side rule (read top / output bottom):** every edge *into* a process docks at its **top** edge (a read) and every edge *out of* a process docks at its **bottom** edge (a write) — decided by edge direction, not geometry. When a process reads a store that sits below it (e.g. a shared store), the edge routes up and over into the process top rather than entering the bottom. Stores and externals have no such rule; they attach on whichever side faces the process. Edges attaching to the same node side fan out across it (fixed small gap, ordered by the opposite endpoint's x) so they never stack on one point.
- **Full-bleed canvas, everything floats (supersedes any header-bar / sidebar chrome):** the canvas fills the viewport; the existing `.branding-block` logo sits top-left with the breadcrumb chips floating beside it; the DFD-nav, findings panel, minimap, and FAB (with the legend inside its menu) all float over the canvas — no website-style header bar or structural sidebar.
- Position restore + drag-save reuse the `createLayoutStore` machinery under a **distinct `localStorage` key** from the ERD's `ignatius-layout-positions`. Each *rendered* diagram persists under its own fingerprint, looked up from `window.__FLOW_LAYOUT_KEYS__[diagramId]` (the injected id→fingerprint map) — so navigating between DFDs (and into sub-DFDs) keeps each one's saved layout independently. ERD and flow pools never share storage; opening flows cannot evict ERD layouts.
- DFD drill-down (client-side, single HTML): a process node with `data.hasSubDfd === true` renders a small "⤵"/"+" affordance at every level of the tree. Because `window.__FLOW_MODEL__` carries the **full recursive `FlowDiagram` tree** (each process's `subDfds`), clicking the affordance swaps the rendered diagram to that process's sub-DFD entirely client-side — re-running the flow layout on the sub-diagram's elements — with a breadcrumb/back affordance to ascend. No per-sub-DFD HTML files are emitted and no navigation occurs; one `flow-<name>.html` is self-contained and works offline. (Supersedes the earlier "href to `flow-<subname>.html`" approach, which would have required the CLI to emit a file per sub-DFD and produced dangling links when a sub-file was not generated.)
- **Node documentation dialog (ⓘ badge).** Every flow node — process, external, and store — carries a small ⓘ badge (`data-ignatius="flow-info"`) that opens a documentation dialog rendering that node's markdown. The badge's `pointerdown` stops propagation, so it never starts a node drag or a sub-DFD drill — body-click keeps its drill role; the badge is a dedicated, separate affordance. Content by node kind: a **process** and an **external** render their own `bodyHtml`; a non-`db` **store** renders its `_stores/<name>.md` body; a **`db` store** borrows its entity's business narrative from the ERD model — the same content the data dictionary shows. The resolver reads the ERD model from `window.__MODEL__`: **static** mode injects it on the page (`generateFlowGraph`); **live** mode carries it in the `/api/flow` payload (`entityModel`) and the frontend assigns it to `window.__MODEL__` before building the resolver (so `db`-store docs hot-reload on entity edits). Without it the `db`-store badge would resolve to nothing — process/external badges read their own `bodyHtml` from the diagrams and are unaffected. The dialog reuses the ERD modal chrome (`.modal-backdrop` / `.modal` / `.doc-body`). A token that resolves to nothing is a no-op. Implemented as `FlowSurface` (a stateful wrapper around `FlowDiagramSvg`), `buildFlowDocResolver`, and `FlowDocModal` in `src/App.tsx`; the ⓘ badge + an `onOpenDoc(docToken)` prop in `src/flow-view/FlowDiagramSvg.tsx`. Doc tokens are canonical `proc:<id>` / `ext:<Name>` / `<kind>:<name>`.
- **In-dialog `[[wiki-link]]` routing.** Flow markdown (process / external / store bodies) is parsed with the same `wikiLinkPlugin` as ERD entity bodies (`md.use(wikiLinkPlugin)` in `src/flow-parse.ts`), rendered **optimistically** (no `knownIds`) so every `[[Target]]` becomes a navigable `a.entity-link[data-entity]` anchor. Clicking a link inside the dialog re-resolves the target across **both** flow nodes (processes, externals, stores) **and** ERD entities and swaps the dialog content in place — a process body can link to an entity, a store, or another process. Resolution order for a bare target: entity → process → external → store. Mirrors the wiki-link click delegation at the `src/App.tsx` ERD modal `onClick`. (Supersedes the earlier `db:`-store-click-navigates-to-the-ERD-viewer plan: docs open *in* the flow viewer's dialog, not by navigating away to `graph.html#entity-<id>`.)


## Module: `src/flow-fingerprint.ts`


New module, parallel to `src/layout-fingerprint.ts`.

- `layoutFlowFingerprint(diagram: FlowDiagram): string` — FNV-1a 32-bit hash (same hand-rolled implementation as `layoutFingerprint` at `src/layout-fingerprint.ts:28–34`) over:
  - sorted process ids
  - sorted external ids
  - sorted store refs (`kind:name`)
  - sorted flow edge pairs in resolved `from.kind:from.name > to.kind:to.name` form (not raw authored strings — spelling variants that resolve identically yield the same key)
- Invariant to: process labels, body text, column names in `data`, local/composed numbers, theme changes.
- Sensitive to: adding/removing a process, external, store ref, or flow edge.
- Each `FlowDiagram` has its own fingerprint — position persistence is per-diagram, not per-`FlowModel`.
- Imported by `src/generators/flow-graph.ts` (to build the `__FLOW_LAYOUT_KEYS__` id→fingerprint map — one entry per diagram) and by `src/server.ts` (to build the same map for the `/api/flow` payload).
- NOT imported by `src/App.tsx` — the frontend reads keys from the `window.__FLOW_LAYOUT_KEYS__` map (static) or the `/api/flow` payload's `flowLayoutKeys` field (live), looking up by diagram id.


## Module: `src/generators/flow-dict.ts`


New module, parallel to `src/generators/dict.ts`.

Signature: `generateFlowDict(flowModel: FlowModel, entityModel: Model, findings: FlowDictFindings, mode: 'static' | 'live', opts?: FlowDictOpts): string` — takes the WHOLE `FlowModel` (every DFD), mirroring how `generateDict` renders all entities of a model. The dictionary groups process sections by DFD (a section/heading per top-level diagram, sub-DFD processes nested or listed under their parent), so one `/flow-dict` page covers the model's flows.

**Superseded:** the single-`FlowDiagram` signature — `generateFlowDict` now takes `FlowModel` so serve (`/flow-dict`) and the CLI export render the model's whole process dictionary in one page.

Where:
- `FlowDictFindings = { flowErrors: FlowError[]; globalErrors: GlobalError[] }`
- `FlowDictOpts = { themeMode?: 'dark' | 'light'; graphHref?: string }`

Structure of generated HTML:

- A section per DFD; within it, per-process sections with anchor `#process-<id>`, headed by the composed `dottedNumber`.
- Inputs/outputs table: endpoint | kind marker | data (column list for `db:`, label otherwise) | direction.
- `db:` attribute rows link to the entity's dict section via `href` (static: `dict.html#entity-<entityId>`; live: `graphHref` equivalent).
- Generic (non-`db:`) store sections render the optional `_stores/<name>.md` body when present.
- Process body narrative (rendered HTML).
- Per-process findings disclosure (mirrors dict entity findings).
- Global findings panel (same structure as `generateDict`'s findings panel).
- Theme toggle and FAB (same structure as `generateDict`).

**Exposure (the deferred-earlier wiring).** `generateFlowDict` was built + tested but never reachable. Now:
- **serve** exposes it live at `GET /flow-dict` (FAB-linked from the flow viewer).
- **CLI:** the static `flow [path] -o flow.html` ALSO writes a sibling dictionary file next to it, and the flow viewer's FAB carries a link to that sibling. **Verifiable contract** (assert in `test-flow-cli.ts`): after `flow … -o <out>.html`, a sibling dictionary HTML exists on disk AND the viewer HTML contains an `href` to it. The exact sibling filename is the implementer's call (e.g. `<out>.dict.html`); the *checks* are the existence of the file and the presence of the link.


## Server: `src/server.ts`


**`serve` makes flows a first-class live surface alongside the ERD (`/`) and dict (`/dict`) — path-first, no DFD in the URL, just like the rest.** New routes added to the existing Bun `routes:` object (mirroring `/dict` + `/api/model`):

- `GET /flow` → `parseFlows` + `validateFlows` + `generateFlowGraph(flowModel, …, 'live', …)`; returns the flow viewer HTML with `window.__IGNATIUS_SURFACE__ = "flow"` injected (so the surface is defined before the bundle runs). No DFD name in the path — the viewer holds all DFDs and navigates in-app.
- `GET /api/flow` → `{ diagrams: FlowDiagram[]; entityModel: Model; validation: FlowValidationResult; flowLayoutKeys: Record<string,string> }` — the payload `initFlowGraph`'s live branch fetches and re-fetches on SSE. `entityModel` rides along so the doc dialog can resolve `db:` store docs (the live branch assigns it to `window.__MODEL__` before init).
- `GET /flow-dict` → `generateFlowDict(...)` for the model's flows (the deferred-earlier dict wiring, now live).
- **FAB navigation** (the consistency rework): the FAB that already hops graph↔dict gains a **Flows** item. `generateDict`/the graph viewer FAB link to `/flow`; the flow viewer's FAB links back to `/` (ERD) and `/dict`. All three live surfaces are mutually reachable, exactly as graph and dict already are.
- **Hot-reload:** the SSE `model-changed` event already fires for any `.md` under `modelsDir`, and `flows/` lives there — so editing flow markdown already emits the event. The flow viewer's live branch subscribes and re-fetches `/api/flow`. No watcher change.
- `FlowRulesConfig` is read from `Model._meta.flowRules`.

When the model has no `flows/`, `/flow` returns a friendly empty-state page (and the FAB Flows item may be omitted), never a 500.


## Tests


All new scripts go under `test/checks/` (raw assertion scripts, run by `bun run test`). New fixtures go under `test/fixtures/`.

| File | What it checks |
|------|----------------|
| `test/checks/test-parse-flows.ts` | `parseFlows` returns correct `FlowDiagram` shapes from a clean fixture; no `flows/**` file appears in `parseModels` nodes; same-named folders nest recursively (`hasSubDfd` true, `subDfds` populated to the leaves); optional `_stores/<name>.md` body attaches to its `FlowStoreRef`; `dottedNumber` composes from local `number:` along the path |
| `test/checks/test-flow-endpoints.ts` | `resolveEndpoint` resolves bare name when unique; returns `null` on collision; qualified `ext:` / `db:` / `proc:` always resolves without ambiguity check; unknown qualified name returns `null` |
| `test/checks/test-validate-flows.ts` | Each of the 11 `flow.*` rules fires on the `test/fixtures/broken-flow/` fixture; each is absent on the clean fixture; Class B stripping removes the correct edges from `cleanedFlowModel`; `flow.unknown_attribute` fires on both a string and an array `data` on a `db:` endpoint; `flow.process_to_process` is skipped when `config.process_to_process === false`; `flow.duplicate_number` fires on a sibling local-number collision |
| `test/checks/test-flow-fingerprint.ts` | `layoutFlowFingerprint` changes on node/edge add or remove; stable on label, body, column-list, local-number edits; two endpoint spellings that resolve to the same `kind:name` pair yield the same key |
| `test/checks/test-flow-leveling.ts` | Recursive sub-DFD detection from nested same-named folders; `flow.unbalanced_decomposition` fires on a boundary *column-set* mismatch at a deep seam; absent on a matched set; sibling-internal flows excluded from the boundary set |
| `test/checks/test-flow-cli.ts` | `flow [path] -o f.html` (path-first, no DFD name) exits 0 and writes one viewer for a clean model; `-o` omitted → exit 1; Class B finding → exit 1; no-`flows/` model → exit 0 with a note; `ignatius validate` includes flow findings when `flows/` exists |
| `test/checks/test-flow-dict.ts` | `generateFlowDict` returns an HTML string containing a process section for each `FlowProcess`; `db:` attribute rows present; optional `_stores/` description rendered when present; findings panel present when findings > 0; absent when findings = 0 |
| `test/checks/test-flow-serve.ts` | `serve` answers `GET /flow` (live viewer, `__IGNATIUS_SURFACE__='flow'`), `GET /api/flow` (`{diagrams, validation, flowLayoutKeys}`), `GET /flow-dict`; a no-`flows/` model returns an empty-state, not a 500 |

**Fixture layout:**

```
test/fixtures/
  flows/
    clean/                  ← single-DFD clean fixture, with nested decomposition + a _stores/ description
      _externals/
        Shopper.md
      _stores/
        Sessions.md         ← optional non-db store description (kind: cache)
      Place-Order.md
      Place-Order/          ← sub-DFD (recurses)
        Reserve-Stock.md
    broken-flow/            ← one violation per flow.* rule (11 rules)
      _externals/
      ...
```

The fixtures use entity ids from `models/key-inherited/` as their `db:` store references so the tests can resolve against a real entity catalog without duplicating schema.

**Existing test impact:**

- `test/checks/test-validate-entity.ts` and `test/checks/test-validate-refs.ts` must still pass — the `RuleId` union extension is additive and `RULES` completeness is enforced by TypeScript, not by these tests.
- `test-api-model.ts` is unaffected (adds a new endpoint, does not change `/api/model`).
- Visual checks in `test/visual/` are unaffected by default; `screenshot-flow-graph.ts` is added as a new visual check (Playwright, manual only, not run by `bun run test`).


## Risks


| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `App.tsx` flow render path balloons component complexity past maintainability; ERD mode regressions become hard to catch | Medium | Flow render fully gated behind `window.__IGNATIUS_SURFACE__ === 'flow'`; all flow Cytoscape setup in `initFlowGraph`; flow styles in a dedicated stylesheet builder, never appended to the ERD `buildStyles`, so the two cannot regress each other; CP-4b's `bun run test` + visual screenshot are the regression gate |
| Entity file exclusion (`flows/**`) in `src/parse.ts` is added as a path check but underlying Bun.Glob pattern changes break other parse paths | Low | The exclusion is a path-startsWith check on the existing scan loop — not a glob rewrite; typecheck + `test-validate-refs.ts` (clean baseline) remain the signal |
| Cytoscape has no built-in DFD-standard open-ended cylinder; the `barrel` shape is an approximation | Medium | Accepted in v1 — DFD is communication-first, not notation-rigorous; revisit with a custom SVG shape if users object |
| Data-level `flow.unbalanced_decomposition` is sensitive to endpoint id normalization and column-set comparison; mismatches due to label vs id comparison produce false positives | Medium | Balancing always compares resolved `(FlowEndpoint.name, column)` pairs (not raw authored strings), excludes sibling-internal flows, and recurses per seam; `test-flow-leveling.ts` covers a matched set (no false positive), a column-level mismatch (true positive), and a deep-seam case |
| Recursive decomposition with no depth cap allows a cyclic folder structure (a process folder that re-enters an ancestor) to loop the parser | Low | `parseFlows` tracks the visited folder path during recursion and refuses to re-enter an ancestor; depth is bounded by the real folder tree, which cannot be cyclic on disk |
| `formatFindingsForStderr` signature change (adding `flowErrors`) breaks existing call sites | Low | Added as an optional parameter with `= []` default; all existing callers compile unchanged; CP-5 adds the flow-aware call |
| `ignatius validate` calling `parseFlows` on models without a `flows/` directory adds latency | Low | Guard with an existence check on `flows/` before running `parseFlows`; no structural change to existing validate path |


## Change log


### 2026-06-09 — Correction: store `kind:` enum includes `other`

**What changed:** The non-`db` store frontmatter comment now lists `other` among the valid kinds.

**Why:** Correction — the body lagged the code. `src/flow-parse.ts` (`FlowStoreRef.kind`, `VALID_KINDS_LIST`) and `src/theme-defaults.ts` (`FLOW_KIND_KEYS`) have accepted `other` all along; the skill's `flow-templates.md` documents it. The spec body was the one surface omitting it.


### 2026-06-06 — Live-mode db-store docs (entityModel in /api/flow) + ⓘ glyph/placement fixes


**What changed:** Three fixes to the node documentation dialog after first-pass review:

1. **Live `db`-store docs.** In live `serve` mode `window.__MODEL__` is not injected on the `/flow` page, so the doc resolver had an empty entity map and `db`-store badges did nothing (process/external worked — they read their own `bodyHtml`). `/api/flow` now includes `entityModel: Model`, and `initFlowGraph`'s live branch assigns it to `window.__MODEL__` before building the resolver — so `db`-store docs resolve and hot-reload on entity edits. Locked by a `test/checks/test-flow-serve.ts` assertion (`payload.entityModel.nodes` non-empty).
2. **Store badge placement + clickability.** The store ⓘ was drawn *above* the box, where the edge's data chip could sit on top and swallow the click. Moved inside the body at the right edge (vertically centred, on the store fill); `storeWidth` reserves a right slot (`STORE_INFO_PAD`).
3. **Icon glyph.** The badge is the Unicode ⓘ (U+24D8), matching the app's glyph convention (no icon library), with a dark backing disc for legibility on saturated fills.

**Why:** the feature was verified only against static `generateFlowGraph`; the live serve path was never exercised, so the live `db`-store gap and the store-badge click-swallow slipped through. The visual harness now clicks process, external, AND store badges, and a live-serve probe covers the `/flow` route.


### 2026-06-06 — Node documentation dialog + in-dialog [[wiki-link]] routing


**What changed:** Every flow node (process, external, store) now carries a ⓘ badge that opens a documentation dialog rendering that node's markdown. Process/external bodies come from their own files; non-`db` stores from `_stores/`; a `db` store borrows its entity's business narrative from the ERD model (`window.__MODEL__`, already on the flow page). Flow markdown is now parsed with `wikiLinkPlugin` (`md.use` in `src/flow-parse.ts`), so `[[Target]]` links render as navigable anchors; clicking one inside the dialog re-resolves the target across both flow nodes and ERD entities and swaps the dialog in place. New in `src/App.tsx`: `FlowSurface`, `buildFlowDocResolver`, `FlowDocModal`. New in `src/flow-view/FlowDiagramSvg.tsx`: the `InfoBadge` component + `onOpenDoc(docToken)` prop. Demo: `Collect-Payment.md` gained `[[Payment]]` / `[[PaymentMethod]]` / `[[PaymentAllocation]]` / `[[Customer]]` links. Tests: `test/checks/test-flow-wikilink.ts` (flow bodies render `data-entity` anchors), `test/visual/shot-flow-doc.ts` (badge → dialog → in-dialog navigation).

**Why:** the markdown attached to flow nodes was previously unreachable from the viewer — clicking a node only drilled (processes) or did nothing (stores/externals), so the business context was invisible. The doc dialog surfaces it and makes flows navigable to their explanations the way the ERD already is.

**Superseded:** the earlier "`db:` store click navigates to the entity in the ERD viewer (`graph.html#entity-<id>` / live hash)" plan. Docs now open *in* the flow viewer's dialog via the ⓘ badge — no navigation away — and the ⓘ affordance is uniform across all node kinds, not just `db` stores.


### 2026-06-06 — Shared externals at flows/_externals/ (declare once, use anywhere)


**What changed:** An external can be declared once at `flows/_externals/<Name>.md` and referenced by any DFD at any depth, instead of duplicating its description in every DFD's `_externals/`. `flow-parse.ts` adds `readExternalsDir` (shared loader, returns `extId → {label, body, bodyHtml}`); `parseFlows` loads `flows/_externals/` once and threads it through the recursion; `parseDiagramFolder` now reads only its *local* `_externals/` and, after edges are known, merges in the root externals it actually references (local definition wins). `parseFlows` also skips `_`-prefixed entries under `flows/` so `_externals/` isn't parsed as a DFD. Demo model: the three duplicate `Customer.md` files were replaced by one `models/key-inherited/flows/_externals/Customer.md` documenting all of Customer's behaviours.

**Why:** re-describing a recurring actor (Customer) in every DFD folder is duplication that drifts. One root definition is the single source of truth.


### 2026-06-06 — Fixed-width D# cap (duplicate marker as a thicker left border)


**What changed:** The duplicate-store marker in `StoreNode` is now a thick left border painted in the store-border colour (`<rect width=3>`), replacing the interior line at `x+4`. The interior line carved a visible empty sub-cell that made a duplicated store's `D#` cap look narrower than a single store's; the border-style marker keeps every `D#` cap a uniform fixed width.

**Why:** duplicated-store `D#` caps read as a different (narrower) width than single stores. The cap rect was always 34px, but the interior marker line made the visible D-cell inconsistent.


### 2026-06-06 — Hover focus dimming + drag highlight


**What changed:** `FlowDiagramSvg` gains a `hover` state and computes a focus set (the hovered node/edge plus its connected edges, their endpoint nodes, and their labels). Everything outside the set renders at `DIM_OPACITY` (0.3) with a short opacity transition; nodes, paths, and chips all carry `onPointerEnter`/`onPointerLeave`. Thin edge paths get a transparent wide hit-stroke (`pointer-events: stroke`) so they're hoverable. A `draggingEdge` state highlights the line whose label is being dragged: a bright stroke + thicker width + a matching `arrowHi` marker, coloured by `EDGE_HIGHLIGHT` (`var(--flow-edge-highlight, #f0883e)`, themeable).

**Why:** mirrors the ERD's hover-to-focus behaviour so a reader can trace where a flow connects (hover a store → see its process and line; hover a process → see all its inputs/outputs), and gives clear feedback while repositioning a label.


### 2026-06-06 — Draggable edge labels (slide along the path)


**What changed:** Data-label chips are now draggable in `FlowDiagramSvg`. `orthogonalPath` returns the edge as a point list (`Pt[]`); `pointsToD` serialises it and `projectOntoPolyline` snaps a dragged label to the nearest point on the polyline so it slides along its edge. New `chipOverrides` state (keyed by edge id) holds user placements; a chip drag (`onChipPointerDown` + the chip branch in the SVG pointer-move/up handlers) projects the pointer onto the edge path and persists via the existing layout store under `chip:<edgeId>` keys (`buildPosMap`/`scheduleSave` shared with node drag). Overridden chips skip the auto de-overlap pass and re-project onto the re-routed path after a node move. Chip `<g>` gets `data-ignatius="flow-chip"`, a grab cursor, and `user-select: none`.

**Why:** auto-placement can't always pick the ideal spot; letting the user nudge a label along its line (without it drifting off the line) is the cheapest fix, and it reuses the node-drag persistence/reset wiring.


### 2026-06-06 — Remove obstacle-avoiding edge routing (lines pass behind nodes)


**What changed:** Reverted the per-edge detour routing — `orthogonalPath` is back to a plain orthogonal trunk (`M fromX V channelY H toX V ty`) with no obstacle parameter. Deleted `verticalDetourPoints`, `clearChannelY`, `pointsToPath`, the `Pt` type, and `DETOUR_GAP`. Node boxes are still computed, but only for chip de-overlap (labels stay off nodes); lines may pass behind nodes. Supersedes the "obstacle-avoiding routing" entry below.

**Why:** with the layout now keeping nodes in their own columns (input/output store offsets, external duplication), edges rarely cross a node — and when they do, a clean line passing *behind* the node (lines render under nodes, labels on top) reads better than the detour, which kinked into "loops" at node edges. Simpler code, better result.

**Superseded:** detour-around-node edge routing → plain orthogonal trunks that pass behind nodes.


### 2026-06-06 — Offset output stores off the sink-external column too


**What changed:** The input-store side-offset is now mirrored to output stores: when a process writes to a sink external (drawn below it), its output stores are pushed into side slots so the edge to the sink drops straight down the centre instead of looping around a stacked output store. `procHasExt` was split into `procHasSrcExt` / `procHasSnkExt`; the slot helpers and offset constant are shared by both bands.

**Why:** the same stacking that caused input-side detour loops also hit the output side — Issue Invoice writing `SalesInvoice` directly below it *and* `invoice → Customer` made the invoice edge loop around `SalesInvoice`. Offsetting the output store clears the centre column.


### 2026-06-06 — Offset input stores off the external column (kill detour loops)


**What changed:** `computeFlowLayout` now positions a process's single-reader input stores in side columns (`±1, ±2 …` × `INPUT_OFFSET`) when that process also has a source external above it, instead of stacking every input on the process centre. The external keeps the centre and drops straight down; stores feed in from their own columns. Multi-reader (shared) input stores still sit at the reader centroid.

**Why:** an input store stacked directly under a source external forced the external's edge to route around it, producing the "weird loop" jogs at Party / PaymentMethod / in the Validate-Customer sub-DFD. Offsetting the store removes the obstacle, so the edge is a clean straight drop — matching the hand-arranged target layout.


### 2026-06-06 — Position-aware external duplication (minimize long crossing edges)


**What changed:** Externals are no longer always one centered source + one centered sink node placed in an evenly-spaced row. `flow-layout.ts` now builds an `ExternalRouting`: for each external, partner processes that cluster share one copy, but partners spread beyond `EXT_FAR_THRESHOLD` from their centroid each get a dedicated local copy (`ext:Name--src--<procId>` / `--snk--<procId>`). `computeFlowLayout` positions every external copy directly at its partners' x (source band above, sink band below), and now takes the process-column map (`processColumnX`, hoisted with `PROC_COL_W` to module scope) plus the routing instead of the old `ExtSplitMap`. Store banding/positioning is unchanged; the dead `ExtSplitMap` type and the `extSplitMap` field of `FlowRenderData` were removed.

**Why:** a single external talking to processes across the whole diagram (e.g. `Customer` feeding the leftmost and rightmost processes) produced long edges that crossed the store band and each other. Per-partner copies turn those into short local drops. Threshold-gated so clustered partners still share one copy (fewer boxes).

**Superseded:** unconditional source/sink external split placed in an evenly-spaced row → position-aware per-partner duplication placed above readers / below writers.


### 2026-06-06 — Obstacle-avoiding edge routing


**What changed:** `FlowDiagramSvg.tsx` — edge paths now route around node boxes that lie on the line (excluding the edge's own endpoints). `verticalDetourPoints` steps a vertical run sideways around a blocking box on the side toward the target; `clearChannelY` nudges the horizontal label channel to a y clear of boxes. The router applies both to the source-side and target-side verticals. Node boxes are computed once (`nodeBoxById`) and reused as routing obstacles and chip-collision targets.

**Why:** a long edge (e.g. an external feeding a process that sits directly below an input store) ran straight under the intervening node, hiding the line. Note: a process reading both an external and a store stacked directly above it still produces a step-around detour rather than a perfectly straight line — fully straightening that needs a layout change (co-inputs placed side by side), tracked separately.


### 2026-06-06 — Edge labels: newline-separated, mid-line, layered, de-overlapped


**What changed:** `FlowDiagramSvg.tsx` — (1) data labels list one column per line instead of comma-joining; (2) chips sit at the middle of their edge instead of just outside the target, so they clear the arrowheads; (3) rendering is split into three layers — all edge paths (under nodes), nodes, all chips (on top) — so a line never draws over another edge's label; (4) a `deoverlapChips` pass scans each chip outward from its natural y to the nearest slot clear of node boxes and previously-placed chips. `EdgeLine` was split into `EdgePath` + `EdgeChip`; `edgeChannelY` now returns the midpoint for normal down-jogs (near-target only for the rare up-and-over).

**Why:** comma-joined labels were hard to read; mid-target chip placement put labels on the arrowheads and made it unclear which line a label belonged to; lines drawing over labels and labels overlapping each other (and the duplicated centre-column stores) were unreadable.


### 2026-06-06 — Duplicate read+write stores into a read copy and a write copy


**What changed:** A store that is both written and read is now drawn twice — a read copy in the input band (above its readers) and a write copy in the output band (below its writers), both carrying the same `D#` and a duplicate-store double-bar — rather than placed as a single shared node between the processes. Implemented in `flow-layout.ts`: a `StoreSplitMap` (mirroring the existing `ExtSplitMap`) yields `--read`/`--write` node ids; `computeFlowLayout` bands them by suffix; the edge builder routes a store-as-source to the read copy and a store-as-target to the write copy. The now-unreachable `shared` band and the store node's `shared` field were removed. `StoreNode` renders the duplicate double-bar via a new `duplicated` flag.

**Why:** with the read-top/output-bottom connection rule, a process reading a store that sat below it produced a long edge routing up and over into the process top — visually noisy. Drawing the store twice (a standard DFD convention for a heavily-accessed store) keeps every read and every write a short straight arrow.

**Superseded:** "a store written by one process and read by another (the shared store) is placed between them as the bridge" → read+write stores are duplicated into a read copy (input band) and a write copy (output band).


### 2026-06-06 — Edge routing: fan-out, uniform solid flows, read-top/output-bottom


**What changed:** Three edits to the SVG render (`src/flow-view/`):

1. **Fan-out edge anchors** — edges no longer all attach to a node's center-x. When multiple edges touch the same side (top/bottom) of a node, their attachment points spread along that side at a fixed 5px gap, ordered by the opposite endpoint's x so the fan doesn't self-cross. Recomputed against live positions, so anchors re-balance on drag. (`computeEdgeAnchors` in `FlowDiagramSvg.tsx`.)
2. **Dropped the dashed-read / solid-write distinction entirely.** All data flows now render as one uniform solid grey arrow; read vs write is conveyed by arrow direction (store→process reads, process→store writes), per canonical SSADM/Gane-Sarson notation. The `isRead` field is removed from the render edge type (`flow-layout.ts`), and the second arrow marker / amber colour / dashed stroke are gone from `FlowDiagramSvg.tsx`.
3. **Process connection-side rule (read top / output bottom).** A process's attach side is now decided by edge direction, not geometry: edges into a process dock at its top, edges out dock at its bottom. A read from a store below the process routes up and over into the top. Stores/externals still attach on the side facing the process. Implemented via a shared `endpointSide` helper used by both the fan-out grouping and the path router; the router now sets its horizontal channel just outside the target (`EDGE_APPROACH`) so every edge ends in a vertical stub into the node.

**Why:** the dashed-read/solid-write mapping was a project invention, not an SSADM convention — canon uses arrow direction for read/write, and reserves dashes for external↔external context flows (which ignatius forbids via `flow.illegal_connection`, so no legitimate dashed case exists). It was never recorded as a deliberate deviation and left users unable to tell flows apart. Edges previously stacked on one anchor point per node, making lines untraceable, and a process's attach side was decided by geometry, so a read from a below-store entered the process bottom — visually indistinguishable from an output.

**Superseded:**
- "Read edges dashed, write edges solid" (Render section) → all flows uniform solid; direction encodes read/write.
- Geometric (lower-node-top / higher-node-bottom) edge attach sides → process inputs always dock top, outputs always dock bottom.


### 2026-06-06 — Flow viewer redesign (real DFD render)


**What changed:** The flow viewer is rebuilt as a purpose-built DFD render against the approved mock `tmp/mock-e.html`, replacing the ERD-reskin. Three supersessions in the Render section: (1) ELK-layered layout → a custom DFD banded auto-layout (processes side by side, inputs above / outputs below, shared store as the P→P bridge, no process-to-process edges) fed to Cytoscape as `preset` then drag-to-arrange; (2) Cytoscape `barrel`/`cut-rectangle` shape approximations → Gane-Sarson notation (numbered process hubs, green externals, open-ended `D#` stores via custom SVG), data-only edge labels, dashed-read/solid-write; (3) any header-bar/sidebar chrome → full-bleed canvas with everything floating (existing `.branding-block` logo + breadcrumb chips beside it, floating DFD nav, findings, minimap, FAB with legend in its menu).

**Why:** the user reported the shipped viewer looked like "a DFD stuffed into an ELK diagram" — wrong layout, shape approximations, bolt-on chrome. Aligned the design through five mock iterations (mock-a…e); mock-e is locked.

**Superseded:**
- Flow layout "reuses the ELK layered engine" → custom DFD banded layout (no ELK).
- Process/external/store shapes `roundrectangle`/`rectangle`/`barrel`/`cut-rectangle` → Gane-Sarson notation via custom SVG (open-ended store, not `barrel`).
- The "barrel is an approximation, accepted in v1" risk → resolved (custom SVG notation).


### 2026-06-06 — First-class surface rework (CLI + serve consistency)


**What changed:** Reworked the entry points so flows behave exactly like `graph`/`dict`/`validate` — no special API. CLI `flow` is now **path-first** (`flow [path] -o`), the required DFD-name positional is removed, and a DFD is chosen by in-app navigation (a model's many DFDs are like the ERD's many entities). `generateFlowGraph` now serializes the whole `FlowModel` (all DFDs) and injects a `__FLOW_LAYOUT_KEYS__` id→fingerprint map; `initFlowGraph` renders a DFD selector and swaps between top-level DFDs via the existing drill-down swap, persisting each diagram independently. `serve` gains live `/flow`, `/api/flow`, `/flow-dict` routes, FAB cross-nav (graph↔dict↔flow), and SSE hot-reload. `generateFlowDict` (built earlier, never exposed) is now reachable from both CLI export and serve. Active build plan = Rework checkpoints CP-R1–R3; CP-1–8 retained as shipped history.

**Why:** the name-first `flow <name>` broke the path-first convention every other verb follows (`flow models/x` searched for a DFD literally named `models/x`), and live-serving flows was deferred during the autopilot build. The user reported both as friction; flows should be first-class in the running tool.

**Superseded:**
- CLI `flow <name> [path]` (name-first positional, `flow-<name>.html` default) → `flow [path] -o` (path-first, `-o` required), render-all.
- `generateFlowGraph(flowDiagram, …)` + `window.__FLOW_LAYOUT_KEY__` (one diagram, one key) → `generateFlowGraph(flowModel, …)` + `window.__FLOW_LAYOUT_KEYS__` (all diagrams, key map).
- Server flow routes "deferred (CP-5b)" → built (`/flow`, `/api/flow`, `/flow-dict`) with FAB nav + hot-reload.


### 2026-06-05 — Implementation amendments


**What changed:** Two corrections surfaced during the autopilot build. (1) `generateFlowGraph` is async `Promise<string>` with a `sourceOrDir?` bundle-source parameter (mirrors `generateGraph`'s DI), and must escape `</script>` in the injected `__FLOW_MODEL__` JSON. (2) Static DFD drill-down is client-side diagram-swap within the single `flow-<name>.html` (the full recursive tree rides in `__FLOW_MODEL__`), not navigation to per-sub-DFD HTML files.

**Why:** (1) the bundle load is async and the unescaped JSON injection was a script-breakout risk; (2) per-file drill-down would force the CLI to emit a file per sub-DFD and yield dangling links when a sub-file was not generated.

**Superseded:**
- `generateFlowGraph(...): string` (sync, 4-arg) → async `Promise<string>` with optional `sourceOrDir`.
- Drill-down "href to `flow-<subname>.html`" → client-side sub-DFD swap, one self-contained HTML.


### 2026-06-05 — Pressure-test amendments


**What changed:** Folded eight decisions settled during `/pressure-test` into the contract. Six new or rewritten body areas: `db:` data always column-checked; full-tree recursive decomposition; data-level (column) balancing at every seam; local-authored / tree-composed process numbering with a new `flow.duplicate_number` rule (flow rules 10 → 11); one-bundle / separate-render-path with a dedicated flow stylesheet builder; per-surface `localStorage` key for flow positions. Added the optional `_stores/<name>.md` non-`db:` store description feature. Updated types (`FlowData` semantics, `FlowProcess.number` → local + `dottedNumber`, `FlowStoreRef.body?`, `FlowDiagram.subDfds` recursion), the rule catalog, success criteria, checkpoints (CP-1/2/4b/6/7/8), tests, and risks (added recursion-cycle guard) to match.

**Why:** The original spec contracted a one-level, box-level, brackets-decide-checking design that diverged from the intended behavior surfaced in pressure-testing. A fresh subagent reading the prior body would have built the superseded design.

**Superseded:**
- A string `data` on a `db:` endpoint was an opaque, unchecked label — now it is a single column, always checked.
- Decomposition was "one level only in v1" — now recurses to the leaves.
- `flow.unbalanced_decomposition` compared endpoint-name sets at one level — now compares column sets per outside connection at every seam.
- Process numbering was auto-assigned by alphabetical folder order with a full dotted `number:` override — now the author writes a local rank and the tool composes the dotted number; sibling-local uniqueness is validated by `flow.duplicate_number`.
- Flow node shapes were set by appending flow selectors to the ERD `buildStyles` — now a dedicated flow stylesheet builder, never shared with ERD.
- Flow positions reused the ERD's single `localStorage` key/pool — now a distinct key per surface.


### 2026-06-08 — Per-process in/out data examples (CP16)


**What changed:** Added `FlowExampleRow`, `FlowExample`, and the optional `examples?: { in: FlowExample[]; out: FlowExample[] }` field to `FlowProcess`. Added `parseProcessExamples` in `src/flow-parse.ts` to parse the `examples:` frontmatter block defensively (missing or malformed entries produce empty arrays, not errors). Added the `FlowProcessExamplesSection` component to `src/App.tsx`; `FlowNodeModal` renders it after the markdown body for process nodes. Demo examples added to `models/key-inherited/flows/order-to-cash/Collect-Payment.md`. Spec amended: `FlowProcess` type updated, process frontmatter contract extended, `examples:` rendering contract added, non-goal for `flow.example_unknown_*` validation added. Tests: `test/checks/test-cp16-process-examples.ts` (parse unit test — happy path, no-examples, heterogeneous rows) and `test/visual/test-cp16-process-examples.ts` (Playwright — dialog shows 4 tables in dark + light, Issue-Invoice shows no section).

**Why:** Processes needed a way to capture and display sample data to make data flows more concrete for reviewers and developers. The feature mirrors the entity `examples:` accordion (same CSS class, same blank-cell pattern) and is strictly additive — no existing parse/validate/render paths are touched.

**Superseded:** the "process-level sample data is a deferred open question" status → process `examples: { in, out }` frontmatter is now first-class and rendered in the process dialog. Queue/message payload *validation* (`flow.example_unknown_*`) remains a non-goal.


### 2026-06-03 — Initial


**What changed:** Authored the full implementation contract for SSADM process flows. Specifies `FlowModel` types and `parseFlows` in a new `src/flow-parse.ts`; `validateFlows` + all `flow.*` rules in a new `src/flow-validate.ts` plus `RuleId` / `RULES` extensions in `src/validate.ts`; `src/flow-fingerprint.ts` (FNV-1a per-diagram topology hash); `src/generators/flow-graph.ts` and `src/generators/flow-dict.ts`; the `ignatius flow` CLI subcommand; `validate` integration; live-server routes; flow render path (`initFlowGraph`) in `App.tsx`; 8 implementation checkpoints defined (CP-4 split into 4a/4b). Derives from `docs/design/process-flows.md`; all settled decisions from the brief are encoded.
