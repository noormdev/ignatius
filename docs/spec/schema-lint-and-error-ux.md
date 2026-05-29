# Schema lint + error UX — spec


## Goal

Run a structured linter at parse time that produces a `LintReport` alongside the `Model`, and surface findings on every consumer — static dict, static graph, interactive viewer, and CLI stderr — so misconfigured or broken entities are visible rather than silent or crash-inducing.


## Non-goals

- Auto-fix. Lint reports; user fixes.
- Model-design suggestions ("consider promoting X to a basetype"). Lint catches what is wrong, not what is suboptimal.
- LSP / IDE integration. CLI + browser surfaces only.
- Linting markdown body content (free-form prose, out of scope).
- Configurable severity policy. Severities are hardcoded in v1; a config surface can be added later.
- `--strict` flag promoting warnings to errors — deferred to a later iteration; exit code semantics in this spec cover errors only.


## Success criteria

- Loading a model with an entity whose YAML frontmatter is unparseable produces a global error banner on the dict and graph outputs naming the file and reason; the entity is absent from the rendered output.
- Loading a model where an entity declares `classification: kernel` but its `pk` contains an FK column shows a warning marker on that entity with a message explaining the dependency mismatch.
- Loading a model where an FK edge references an entity id that does not exist in the model shows a warning marker on the source entity; dict anchor links to `#missing-<target-id>`; graph node carries a `⚠` badge.
- Loading a model where `subtype.basetype` or a cluster `members` entry references a missing entity shows a warning marker; the cluster still renders with the known members.
- An entity with `classification: dependent` but no PK column that is also an FK receives a warning marker explaining the classification mismatch.
- An entity with an empty `pk` array receives a warning marker; cardinality falls back to a dependent default.
- Loading a model with no lint findings produces no banners or markers on any surface.
- Running `ignatius dict` or `ignatius graph` on a model with errors exits with code `1`; running with only warnings exits with code `0`.
- CLI stderr lists all findings in the format `<severity>  <CATEGORY>  <file>  <message>`, one per line, sorted errors-first, then category alphabetical, then entity id alphabetical within each severity.
- In the interactive server viewer (`ignatius serve`), fixing a file and saving causes the existing SSE `model-changed` reload to pick up the updated lint report; banners and node markers update without a full page reload.
- An entity with a `group` that has no matching `_groups/<group>.md` file renders without a color band and carries a warning marker.


## Approach

The design's chosen approach: `parseModels(dir)` is extended to return `{ model, lintReport }` instead of `Model` directly. The parser is the sole source of lint truth — generators and the server never re-run rules. Each rule walks the already-parsed structure (no second parse pass). Generators (`generateDict`, `generateGraph`) accept both `model` and `lintReport` as peer arguments and embed banners and markers into their HTML output. The server's `/api/model` response payload becomes `{ model, lintReport }`; the React viewer holds both in state. All existing call sites are updated to destructure the new return shape in the same checkpoint that introduces the type.


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Verifies |
|---|------------|---------------|-------|----------|
| 1 | Parser — `LintReport` type + schema rules | `src/parse.ts` | atomic-builder | `parseModels` returns `{ model, lintReport }`; all existing call sites updated; `SCHEMA_INVALID_YAML`, `SCHEMA_MISSING_ID`, `SCHEMA_MISSING_FIELD`, `SCHEMA_INVALID_FIELD_TYPE` findings fire on synthetic test fixtures; naming rules (`NAMING_NOT_PASCAL_CASE`, `COLUMN_NAME_NOT_SNAKE_CASE`) also implemented here |
| 2 | Parser — type integrity + cardinality rules | `src/parse.ts` | atomic-surgeon | `FK_UNKNOWN_TARGET`, `SUBTYPE_UNKNOWN_BASETYPE`, `SUBTYPE_UNKNOWN_MEMBER`, `GROUP_UNKNOWN`, `CLASSIFICATION_MISMATCH_DEPENDENT`, `CLASSIFICATION_MISMATCH_INDEPENDENT`, `PK_EMPTY` fire correctly on the reference `models/` set; after any pre-existing violations in the reference `models/` set are fixed, the lint report is empty for that input; smoke tested via a synthetic fixture |
| 3 | Dict surface | `src/generators/dict.ts` | atomic-builder | Global error banner static at the top of the page, above the page header, not sticky on scroll (red, lists omitted entities + reasons); per-entity `⚠` marker opens a `<details>` block listing that entity's findings; FK anchors to omitted entities render as `<a class="dict-link-missing" href="#missing-<id>">` with a `#missing-<id>` placeholder section at page bottom |
| 4 | Server API + CLI stderr | `src/server.ts`, `src/cli.ts` | atomic-builder | `/api/model` returns `{ model, lintReport }`; React viewer updates banner and node markers on SSE reload; `ignatius dict` and `ignatius graph` print findings to stderr, exit `1` on errors and `0` on warnings-only |
| 5 | Graph surface | `src/App.tsx`, `src/styles.css`, `src/generators/graph.ts` | atomic-builder | Global banner overlay at top of canvas; each node with findings shows a `⚠` corner badge; clicking the node's existing modal opens an "Issues" section listing its findings; omitted entities absent from canvas; banner names them |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Existing call sites that destructure the return of `parseModels` directly (e.g. `const model = await parseModels(...)`) will type-error when the return shape changes | High | CP-1 explicitly requires updating all call sites in the same commit; verify with `bun build` or `tsc --noEmit` as part of CP-1 signals |
| Cross-entity lint checks in CP-2 depend on the full node map being built before edges are walked; current parse order may not guarantee this | Medium | Build the node id set in a first pass, then run cross-entity checks in a second pass over the same already-parsed data |
| React viewer currently expects `/api/model` to return a `Model`; changing the payload shape is a breaking change if not coordinated with the graph surface CP | Medium | CP-4 (Server API) and CP-5 (Graph surface) must land together, or CP-5 must tolerate the transitional payload shape during any interim |
| `⚠` badge on Cytoscape nodes requires a custom renderer or absolute-positioned DOM overlay; the crow's-foot overlay pattern exists but is canvas-based, not per-node | Medium | Use the same canvas overlay approach as `src/markers.ts` for badges, or use Cytoscape's built-in label+background trick for a simpler first pass |
| The reference `models/` set is expected to be lint-clean; any existing rule violations would produce false positives and obscure whether the rules are firing correctly | Low | Run against `models/` before finalizing CP-2; fix any actual model issues first so a clean run confirms rule correctness |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->
