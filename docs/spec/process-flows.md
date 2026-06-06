# SSADM process flows — implementation contract


Derived from `docs/design/process-flows.md`.


## Goal


Add SSADM data flow diagrams to ignatius: file-per-process markdown authoring, shared `db:` store resolution against the entity catalog, well-formedness validation riding the existing `flow.*` rule registry, and Cytoscape rendering via a separate flow render path in the existing bundle.


## Non-goals


- Hard balancing *enforcement* — decomposition mismatch is a soft warning only (the comparison is data-level, but it never blocks).
- The current-physical → logical → required SSADM progression and logicalisation.
- Schema validation on non-`db:` stores (cache/queue/file/doc/manual have no schema here; `_stores/<name>.md` adds an optional *description*, not a schema).
- Queue/message payload shape validation — non-`db:` flows carry opaque labels in v1; validating a `queue:` payload against a declared shape is out of scope.
- Auto-promotion of discovered attributes into entities — `flow.unknown_attribute` surfaces a gap; closing it (editing the entity) is the author's job, not the tool's.
- Perfect auto-layout — drag-to-save covers the gap.
- LDS (already the ERD) and ELH — out of scope.
- A second compiled bundle for the flow viewer (v1 renders flow via a separate render path inside the existing bundle).


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


- `ignatius flow checkout models/shop` writes `flow-checkout.html` and exits 0 (exits 1 when any Class B flow finding is present); the DFD renders with the four canonical node shapes (external, process, db store, generic store) and at least the edges declared in the flow markdown.
- `ignatius validate models/shop` reports `flow.*` findings on stderr and exits non-zero when any Class B flow rule fires.
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


| # | Checkpoint | Files / areas | Agent | Est. files | Verifies |
|---|------------|---------------|-------|-----------|----------|
| 1 | `FlowModel` types + `parseFlows` + recursive folder discovery + `_externals/` + optional `_stores/` + local→dotted numbering + entity-file exclusion | `src/flow-parse.ts` (new), `src/parse.ts` (path exclusion), `test/checks/test-parse-flows.ts` (new), `test/fixtures/flows/` (new) | atomic-builder | 4 | `parseFlows` returns `FlowModel` with processes, externals, flow edges, store refs; same-named folders nest recursively to leaves; optional `_stores/<name>.md` body attaches to its `FlowStoreRef`; `dottedNumber` composes from local `number:` along the folder path; no flow process file appears in `parseModels` entity nodes; typecheck clean |
| 2 | `validateFlows` + all 11 `flow.*` rules in `RULES` registry | `src/validate.ts` (extend), `src/flow-validate.ts` (new), `test/checks/test-validate-flows.ts` (new), `test/fixtures/broken-flow/` (new) | atomic-builder | 5 | All 11 `flow.*` rules fire on the broken fixture; all are absent on a clean fixture; `RULES` compiles (Record completeness enforced by TypeScript); Class B rules strip edges from `cleanedFlowModel`; `flow.unknown_attribute` fires on both string and array `data` on a `db:` endpoint |
| 3 | Endpoint resolution + ambiguity | `src/flow-parse.ts` (resolution logic), `test/checks/test-flow-endpoints.ts` (new) | atomic-builder | 2 | Bare name resolves when unique across three namespaces; collision emits `flow.ambiguous_endpoint`; qualified names (`ext:`, `db:`, `proc:`, `cache:`, …) always resolve without ambiguity check; unknown qualified `db:` endpoint emits `flow.unknown_store`; unknown qualified `ext:` emits `flow.unknown_external` |
| 4a | `generateFlowGraph` static HTML injection | `src/generators/flow-graph.ts` (new) | atomic-builder | 1 | Static `flow-<name>.html` is written with correct `window.__IGNATIUS_SURFACE__`, `window.__FLOW_MODEL__`, `window.__FLOW_LAYOUT_KEY__`, `window.__IGNATIUS_MODE__ = "static"`; no App.tsx change; verifiable by parsing the emitted script tags |
| 4b | App.tsx flow render path — `initFlowGraph` + separate flow stylesheet + DFD shapes | `src/App.tsx` (flow render path via `initFlowGraph` + own stylesheet builder), `test/visual/screenshot-flow-graph.ts` (new) | atomic-builder | 2 | Static `flow.html` renders: external = rectangle, process = rounded rectangle with composed-number badge, db-store = barrel shape, generic store = cut-rectangle; flow shapes come from a dedicated flow stylesheet builder, NOT appended to the ERD `buildStyles`; ERD selectors untouched; Playwright screenshot taken and inspected |
| 5 | `ignatius flow` CLI subcommand + `validate` integration | `src/cli.ts` (new `flowCmd`, register in `main`), `src/flow-validate.ts` (consumed by validate cmd), `test/checks/test-flow-cli.ts` (new) | atomic-builder | 3 | `ignatius flow <name> [path]` writes `flow-<name>.html` and exits 0 (exits 1 on Class B findings); `ignatius validate` includes flow findings in stderr and exit code; a missing/unknown DFD name exits 1 with a message |
| 6 | `generateFlowDict` process dictionary | `src/generators/flow-dict.ts` (new), `test/checks/test-flow-dict.ts` (new) | atomic-builder | 3 | Static `flow-dict-<name>.html` lists each process with its inputs/outputs table, attribute list for `db:` flows, optional `_stores/` description for generic stores, body narrative, and findings panel; layout mirrors `generateDict` structure |
| 7 | Leveling: recursive client-side drill-down + data-level `flow.unbalanced_decomposition` | `src/flow-validate.ts` (recursive decomposition rule + harden the boundary picker), `src/App.tsx` (`initFlowGraph` client-side sub-DFD swap + back affordance), `test/checks/test-flow-leveling.ts` (new) | atomic-builder | 4 | `flow.unbalanced_decomposition` fires when the boundary *column* sets differ at ANY seam down the tree and is silent when they match (sibling-internal flows excluded); a process with `hasSubDfd` renders a drill affordance that swaps the rendered diagram to its sub-DFD client-side, with a back affordance |
| 8 | Flow layout fingerprint + drag-save reuse with separate storage key | `src/flow-fingerprint.ts` (new), `src/generators/flow-graph.ts` (inject `__FLOW_LAYOUT_KEY__`), `src/App.tsx` (flow-mode store integration under a distinct key), `test/checks/test-flow-fingerprint.ts` (new) | atomic-builder | 4 | `layoutFlowFingerprint` is topology-only (node ids + edge source>target pairs); changes on structural edits, stable on label/body/column-list/local-number edits; static HTML carries `window.__FLOW_LAYOUT_KEY__`; saved positions restore on reload; flow positions persist under a `localStorage` key distinct from the ERD's |


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
```

**Frontmatter contract for external files (`_externals/*.md`):**

```yaml
external: <human label>       # required
```

**Frontmatter contract for optional store description files (`_stores/*.md`):**

```yaml
kind: cache                   # one of: cache | queue | file | doc | manual (db: stores are entities, described in their own .md)
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


Extension points: `src/cli.ts:290–307` (main subcommand registration).

- New `flowCmd = defineCommand(...)` following the `dictCmd` pattern at `src/cli.ts:63–119`.
  - Positional: `<name>` — the DFD folder name to render (required). A missing or unknown DFD name exits 1 with a descriptive message.
  - Optional positional: `[path]` — model search base (default: cwd), consistent with other subcommands.
  - Flag `--model <key>` — model picker key, consistent with other subcommands.
  - Flag `--out <file>` — output path (default: `flow-<name>.html` in cwd).
  - Pipeline: `pickModel(base, modelKey)` → `parseModels(dir)` (entity catalog) → `parseFlows(dir)` → `validateFlows(flowModel, model, config)` → `formatFindingsForStderr(...)` → `generateFlowGraph(...)` → write DFD HTML output file → `process.exit(globalErrors.length > 0 ? 1 : 0)`.
  - Exit code: 1 when any Class B flow finding is present, else 0.
- `validateCmd` at `src/cli.ts:197–241` extended to additionally call `parseFlows` + `validateFlows` when a `flows/` directory exists; merges flow findings into the stderr output and exit-code calculation.
- `flowCmd` registered in `main` at `src/cli.ts:290–307`.
- `config` for `FlowRulesConfig` is read from `Model._meta.flowRules` (loaded by `parseModels` from `ignatius.yml`'s `flow_rules:` block).


## Render: `src/generators/flow-graph.ts` + `src/App.tsx`


**`src/generators/flow-graph.ts` — new module:**

Signature: `generateFlowGraph(flowDiagram, entityModel, mode, opts, sourceOrDir?): Promise<string>` — async (the bundle source is loaded via the same async path as `generateGraph`), returning the HTML string. `sourceOrDir` mirrors `generateGraph`'s dependency-injected bundle source (a model-dir string or preloaded bundle content); it defaults to the embedded bundle so CLI callers can omit it. Parameters: `flowDiagram: FlowDiagram`, `entityModel: Model`, `mode: 'static' | 'live'`, `opts: FlowGraphOpts`.

Where `FlowGraphOpts = { flowLayoutKey: string; themeMode?: 'dark' | 'light' }`.

- Injects `window.__IGNATIUS_MODE__ = "static"`, `window.__FLOW_MODEL__` (the serialized `FlowDiagram`), `window.__FLOW_LAYOUT_KEY__`, `window.__THEME_MODE__`, and `window.__IGNATIUS_SURFACE__ = "flow"` — parallel to `generateGraph` at `src/generators/graph.ts:71–125`.
- Strips the live-mode `window.__IGNATIUS_MODE__ = 'live'` inline body script (same technique as `generateGraph`).
- Escapes `</script>` sequences in the serialized `__FLOW_MODEL__` JSON so a process body containing a markdown code fence cannot break out of the injection `<script>` context.
- Reuses the existing embedded React bundle (`loadEmbeddedBundle`) — no second bundle.
- Verifiable independently (CP-4a): the emitted HTML script tags carry the correct injections without any App.tsx change.

**`src/App.tsx` — flow render path (`initFlowGraph` + dedicated flow stylesheet):**

Extension points: mode dispatch at `src/App.tsx:1067–1119`, elements construction at `src/App.tsx:1257–1345`, styles at `src/App.tsx:340–483`.

- On startup, read `window.__IGNATIUS_SURFACE__`. When `=== 'flow'`, call `initFlowGraph`; otherwise call the existing ERD path unchanged. `src/index.html` carries `window.__IGNATIUS_SURFACE__ = 'erd'` as a default alongside the existing `window.__IGNATIUS_MODE__ = 'live'` so the live ERD reads a defined surface. The live `/flow/<name>` route sets `__IGNATIUS_SURFACE__ = 'flow'` in the HTML it returns so the surface is defined before the bundle executes and the `/api/flow/<name>` fetch has the correct surface context.
- `initFlowGraph` — flow Cytoscape setup is isolated in this extracted function, not interleaved with the existing ERD `useEffect`. It reads `window.__FLOW_MODEL__` (static) or fetches `/api/flow/<name>` (live — endpoint added in server.ts).
- Flow elements construction (inside `initFlowGraph`): map `FlowProcess` → Cytoscape nodes (label carries the composed `dottedNumber` badge); `FlowExternal` → Cytoscape nodes; `db:` store refs → Cytoscape nodes; non-db store refs → Cytoscape nodes; `FlowEdge` → directed Cytoscape edges with the flow label or column list as edge label.
- **Flow styles live in a dedicated flow stylesheet builder, separate from the ERD `buildStyles` — not appended to it.** The flow path builds its own Cytoscape stylesheet (process → `shape: 'roundrectangle'` + number badge; external → `shape: 'rectangle'`; `db:` store → `shape: 'barrel'`; non-db store → `shape: 'cut-rectangle'`). The existing ERD `buildStyles` at `src/App.tsx:340–483` is untouched; flow and ERD never share a stylesheet function. This is the isolation guarantee — editing flow styles cannot regress ERD rendering because they are different builders.
- Flow layout reuses the existing ELK layered engine (top-to-bottom direction suits a DFD) via its own option object; it does not mutate the ERD's `buildLayoutOpts`.
- Position restore + drag-save reuse the `createLayoutStore` machinery but under a **distinct `localStorage` key** from the ERD's `ignatius-layout-positions`, keyed by `window.__FLOW_LAYOUT_KEY__`. ERD and flow position pools never share storage, so opening flows cannot evict ERD layouts.
- DFD drill-down (client-side, single HTML): a process node with `data.hasSubDfd === true` renders a small "⤵"/"+" affordance at every level of the tree. Because `window.__FLOW_MODEL__` carries the **full recursive `FlowDiagram` tree** (each process's `subDfds`), clicking the affordance swaps the rendered diagram to that process's sub-DFD entirely client-side — re-running the flow layout on the sub-diagram's elements — with a breadcrumb/back affordance to ascend. No per-sub-DFD HTML files are emitted and no navigation occurs; one `flow-<name>.html` is self-contained and works offline. (Supersedes the earlier "href to `flow-<subname>.html`" approach, which would have required the CLI to emit a file per sub-DFD and produced dangling links when a sub-file was not generated.)
- `db:` store node click: navigates to the entity in the ERD viewer (static: link to `graph.html#entity-<id>`; live: `ignatius serve`'s `/` with hash). Mirrors the wiki-link click delegation at `src/App.tsx` modal `onClick`.


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
- Imported by `src/generators/flow-graph.ts` for `__FLOW_LAYOUT_KEY__` injection.
- NOT imported by `src/App.tsx` — the frontend reads the key from `window.__FLOW_LAYOUT_KEY__` only.


## Module: `src/generators/flow-dict.ts`


New module, parallel to `src/generators/dict.ts`.

Signature: `generateFlowDict(diagram: FlowDiagram, entityModel: Model, findings: FlowDictFindings, mode: 'static' | 'live', opts?: FlowDictOpts): string`

Where:
- `FlowDictFindings = { flowErrors: FlowError[]; globalErrors: GlobalError[] }`
- `FlowDictOpts = { themeMode?: 'dark' | 'light'; graphHref?: string }`

Structure of generated HTML:

- Per-process sections with anchor `#process-<id>`, headed by the composed `dottedNumber`.
- Inputs/outputs table: endpoint | kind marker | data (column list for `db:`, label otherwise) | direction.
- `db:` attribute rows link to the entity's dict section via `href` (static: `dict.html#entity-<entityId>`; live: `graphHref` equivalent).
- Generic (non-`db:`) store sections render the optional `_stores/<name>.md` body when present.
- Process body narrative (rendered HTML).
- Per-process findings disclosure (mirrors dict entity findings).
- Global findings panel (same structure as `generateDict`'s findings panel).
- Theme toggle and FAB (same structure as `generateDict`).


## Server: `src/server.ts`


Extension (not rewrite) for live-mode flow support:

- `GET /flow/<name>` → calls `parseFlows`, `validateFlows`, `generateFlowGraph`; returns flow HTML with `window.__IGNATIUS_SURFACE__ = "flow"` injected.
- `GET /api/flow/<name>` → returns `{ diagram: FlowDiagram; validation: FlowValidationResult; flowLayoutKey: string }`.
- `GET /flow-dict/<name>` → calls `generateFlowDict`; returns process dictionary HTML.
- SSE `model-changed` event already covers all `.md` files under `modelsDir` via the existing recursive `fs.watch(modelsDir)` + `.md` filter. Because `flows/` lives under `modelsDir`, flow `.md` files are automatically covered — no watcher change is needed.
- `FlowRulesConfig` is read from `Model._meta.flowRules` (populated by `parseModels` from `ignatius.yml`); it is not re-read separately.


## Tests


All new scripts go under `test/checks/` (raw assertion scripts, run by `bun run test`). New fixtures go under `test/fixtures/`.

| File | What it checks |
|------|----------------|
| `test/checks/test-parse-flows.ts` | `parseFlows` returns correct `FlowDiagram` shapes from a clean fixture; no `flows/**` file appears in `parseModels` nodes; same-named folders nest recursively (`hasSubDfd` true, `subDfds` populated to the leaves); optional `_stores/<name>.md` body attaches to its `FlowStoreRef`; `dottedNumber` composes from local `number:` along the path |
| `test/checks/test-flow-endpoints.ts` | `resolveEndpoint` resolves bare name when unique; returns `null` on collision; qualified `ext:` / `db:` / `proc:` always resolves without ambiguity check; unknown qualified name returns `null` |
| `test/checks/test-validate-flows.ts` | Each of the 11 `flow.*` rules fires on the `test/fixtures/broken-flow/` fixture; each is absent on the clean fixture; Class B stripping removes the correct edges from `cleanedFlowModel`; `flow.unknown_attribute` fires on both a string and an array `data` on a `db:` endpoint; `flow.process_to_process` is skipped when `config.process_to_process === false`; `flow.duplicate_number` fires on a sibling local-number collision |
| `test/checks/test-flow-fingerprint.ts` | `layoutFlowFingerprint` changes on node/edge add or remove; stable on label, body, column-list, local-number edits; two endpoint spellings that resolve to the same `kind:name` pair yield the same key |
| `test/checks/test-flow-leveling.ts` | Recursive sub-DFD detection from nested same-named folders; `flow.unbalanced_decomposition` fires on a boundary *column-set* mismatch at a deep seam; absent on a matched set; sibling-internal flows excluded from the boundary set |
| `test/checks/test-flow-cli.ts` | `ignatius flow checkout models/shop` exits 0 and writes `flow-checkout.html`; exits 1 on Class B findings; `ignatius validate models/shop` includes flow findings when `flows/` exists; missing/unknown DFD name exits 1 with a message |
| `test/checks/test-flow-dict.ts` | `generateFlowDict` returns an HTML string containing a process section for each `FlowProcess`; `db:` attribute rows present; optional `_stores/` description rendered when present; findings panel present when findings > 0; absent when findings = 0 |

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


### 2026-06-03 — Initial


**What changed:** Authored the full implementation contract for SSADM process flows. Specifies `FlowModel` types and `parseFlows` in a new `src/flow-parse.ts`; `validateFlows` + all `flow.*` rules in a new `src/flow-validate.ts` plus `RuleId` / `RULES` extensions in `src/validate.ts`; `src/flow-fingerprint.ts` (FNV-1a per-diagram topology hash); `src/generators/flow-graph.ts` and `src/generators/flow-dict.ts`; the `ignatius flow` CLI subcommand; `validate` integration; live-server routes; flow render path (`initFlowGraph`) in `App.tsx`; 8 implementation checkpoints defined (CP-4 split into 4a/4b). Derives from `docs/design/process-flows.md`; all settled decisions from the brief are encoded.
