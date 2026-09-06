# Spec: Model index routing


## Goal


Generate a navigable router into every organizing folder of a model root, so a reader descends root → section → group → entity through small tables instead of globbing the tree. Each router is a markdown table of name, kind, description, and a clickable relative link, wrapped in an `<ignatius-index>` region the generator owns. Per-file hashes roll up into folder digests and a root digest, so `ignatius validate --index` reports drift as a finding. `ignatius index --agents` additionally writes in-folder agent guidance (`AGENTS.md`, a `CLAUDE.md` shim, `SKILL.md`) so a model folder orients any agent that opens a file in it.


## Approach


Per-folder routers, in-folder agent guidance, XML managed regions, per `docs/design/model-index-routing.md`.


## Non-goals


- No change to `ignatius serve`, the SPA, or the static export. Routers are a flat-file surface, not a viewer surface.
- No new link syntax. `[[Entity]]` keeps its current meaning and its current consumer; routers use ordinary relative markdown links.
- No search index, ranking, or embedding.
- No config for which folders get routers, which columns a table carries, or link style.
- No maximum descent depth. Routers nest as deep as the model does.
- No writes outside the model root. The generator never touches a consuming repo's files.
- No `ignatius install-skill` verb. Installing `SKILL.md` as a live skill is the user's move.
- No migration tooling. Routers are generated.


## Success criteria


- SC1 — `ignatius.yml` accepts `index_file:` (default `index.md`) and `harness:` (default `auto`, one of `auto | claude | agents | both`). Both load in `parseModels` alongside the existing `flow_rules:` block and land on `_meta`. A config with neither key parses and defaults.
- SC2 — **Every scan that could read a generated router skips it.** A router is written into `data/<group>/`, `groups/`, `flows/<flow>/`, each sub-DFD folder, `externals/`, and `stores/`, so each of those scans skips a file matching the configured `index_file`: the `data/**/*.md` entity scan and the `groups/*.md` scan in `src/model/parse.ts`, and the process, externals, and stores scans in `src/flows/flow-parse.ts`. A router raises neither `parse.missing_id` nor `parse.invalid_yaml`. Matching is on the **basename** for a recursive glob and on the whole path for a flat one; suffix matching is never used, so a file named `Reindex.md` is still scanned. Running `ignatius index` twice over a model produces clean stderr on the second run.
- SC3 — Three config rules exist and fire: `config.index_file_ext` (value does not end in `.md`), `config.index_file_path` (value contains `/` or `..`), and `config.index_file_entity` (a file matching `index_file` under `data/` declares `entity:`, reported with a message naming the reserved filename, not the generic `parse.missing_id`).
- SC4 — A top-level `description:` string parses on entity, group, flow-process, external, and store files, and reaches the model. Absent `description:` is not an error anywhere.
- SC5 — `ignatius index <root>` writes one `index_file` into the model root and into `groups/`, `data/`, **every subdirectory of `data/` that holds entity files, at any depth**, `flows/`, each flow folder, each sub-DFD folder, `externals/`, and `stores/`. Each contains an `<ignatius-index>` region holding a table with a Kind column, a Description column, and a Go column of relative `file.md` links, plus an `↑` breadcrumb region above it.

- SC5a — **Routers mirror the filesystem, never the declared groups.** A router lists what its own directory actually contains: subdirectory rows and entity rows for the files in that directory. Entity file paths come from the parser's real discovered path, never reconstructed from `group:` plus entity id. A model whose entities sit flat in `data/` gets one `data/index.md` listing them directly; a model that nests gets a router per level. `group:` is a declarative classification that need not match any folder name, so the two must not be conflated. A model must never crash the generator because its layout does not follow the group-as-folder convention.
- SC6 — Rows for child folders carry `Kind: folder`; rows for leaves carry the entity classification (`Independent`/`Dependent`/`Subtype`/`Associative`/`Classifier`) or the node kind (`process`/`external`/`store`). Classification is read from the parsed model, never re-derived in the generator.
- SC7 — Every row carries the SHA-256 of its target. A folder's `digest` attribute hashes its row hashes. A parent's row for a child folder carries that child's digest, never the child's rows. Editing one entity file changes exactly the digests on its ancestor path and no others.
- SC8 — Writing is region-scoped: a second `ignatius index` run over an unchanged model produces a byte-identical tree (idempotent). Bytes outside every `<ignatius-*>` region survive a run verbatim, including a hand-authored `<ignatius-rules>` block, prose, and headings. A file with no region gets one appended; a missing file is created.
- SC9 — `ignatius validate --index` recomputes digests, writes nothing, and reports drift as `index.stale` through the existing `formatFindingsForStderr` pipeline. A plain `ignatius validate` performs no hashing. `index.orphaned` warns when a router file left behind by an `index_file` change is still on disk.
- SC10 — `ignatius index --agents <root>` writes routers **and**, into the model root only, `AGENTS.md` (canonical guide), `SKILL.md` (with generated YAML frontmatter carrying `name` and `description`), and, when the harness resolves to Claude, a `CLAUDE.md` whose body is an `@AGENTS.md` import plus Claude-specific lines. `harness: auto` resolves to Claude when a `.claude/` directory or a `CLAUDE.md` exists at or above the model root.
- SC11 — Guidance files carry no entity, column, or relationship content: the model root's name, description, the resolved router filename, the key-style convention, the `[[Entity]]` body rule, and the root digest. Each stays under 200 lines.
- SC12 — `SKILL.md` frontmatter is the sole content the generator owns outside an `<ignatius-*>` region. Every other generated file, routers included, is region-only.
- SC13 — `skills/ignatius-modeling/` teaches the change: `description:` appears in the entity, group, and flow templates and in the authoring steps that fill them; the reserved `index_file` name is documented as unusable for an entity file; and the verification loop covers `ignatius validate --index`.
- SC14 — `bun run test` exits 0 with every existing check green, and `bunx tsc --noEmit` reports no error in a file the range touches beyond the repo's pre-existing stale-`bun-types` set (CI runs typecheck with continue-on-error). All five in-repo model roots under `models/` and all five fixture roots under `test/fixtures/` still parse and validate.


## Checkpoints


| # | Checkpoint | Files/areas | Verifies |
|---|------------|-------------|----------|
| CP1 | Config keys + reserved-name scan skip + config rules | `src/model/parse.ts`, `src/model/validate.ts`, `src/types/`, `test/checks/test-index-config.ts` | SC1, SC2, SC3 — an `index.md` in a fixture `data/<group>/` parses clean; `Reindex.md` still scanned; all three config rules fire on bad values |
| CP2 | `description:` on the five file kinds | `src/model/parse.ts`, `src/flows/flow-parse.ts`, `src/types/`, `test/checks/test-description-field.ts` | SC4 — description reaches the model for each kind; absence is never an error; existing roots unaffected |
| CP3 | Managed region + fingerprint primitives | `src/router/region.ts`, `src/router/fingerprint.ts`, `test/checks/test-router-region.ts`, `test/checks/test-router-fingerprint.ts` | SC7, SC8 halves — region replace preserves outside bytes and is idempotent; digest roll-up changes only the ancestor path |
| CP4 | `ignatius index` — router build + write | `src/router/build.ts`, `src/router/write.ts`, `src/cli/cli.ts`, `test/checks/test-router-index.ts` | SC5, SC6, SC7, SC8 end-to-end against `models/key-inherited`: every folder gets a router, kinds come from the parsed model, a second run is byte-identical |
| CP5 | `validate --index` | `src/model/validate.ts`, `src/cli/cli.ts`, `test/checks/test-validate-index.ts` | SC9 — `index.stale` fires on a touched entity, plain `validate` hashes nothing, `index.orphaned` warns after a rename |
| CP6 | `index --agents` — guidance files + harness detection | `src/router/agents.ts`, `src/router/detect.ts`, `src/cli/cli.ts`, `test/checks/test-router-agents.ts` | SC10, SC11, SC12 — the three files land in the model root only, `CLAUDE.md` appears only under Claude detection, `SKILL.md` frontmatter is the one non-region write |
| CP7 | Skill + docs | `skills/ignatius-modeling/**`, `docs/guides/`, `docs/wiki/feature-map.md` | SC13 — templates carry `description:`, the reserved name is documented, the verification loop covers `--index`; feature-map row filled to spec/guide/skill |


## Change tree


```
M src/model/parse.ts                     — index_file/harness config read; data- and groups-scan reserved-name skip; description: on entity + group
M src/model/validate.ts                  — config.index_file_* rules; index.stale; index.orphaned; index.unreadable_target
M src/flows/flow-parse.ts                — reserved-name skip in the process, externals, and stores scans; description: on process, external, store
A src/router/region.ts                   — parse/replace/append an <ignatius-*> region, outside bytes untouched
A src/router/fingerprint.ts              — file SHA, folder digest, ancestor roll-up
A src/router/build.ts                    — model + folder tree → RouterFile[]; reads bytes to hash, never writes
A src/router/write.ts                    — region-scoped router writes: the breadcrumb and index regions
A src/router/detect.ts                   — harness resolution from config + ancestor probe
A src/router/agents.ts                   — AGENTS.md / CLAUDE.md shim / SKILL.md content, and writeGuidance
M src/cli/cli.ts                         — indexCmd (+ --agents); validateCmd gains --index
A test/checks/test-index-config.ts       — config keys, scan skip, config rules
A test/checks/test-description-field.ts  — description: across the five kinds
A test/checks/test-router-region.ts      — region replace/append idempotence
A test/checks/test-router-fingerprint.ts — digest roll-up, ancestor-only propagation
A test/checks/test-router-index.ts       — end-to-end router generation
A test/checks/test-validate-index.ts     — index.stale / index.orphaned
A test/checks/test-router-agents.ts      — guidance files + harness detection
M skills/ignatius-modeling/SKILL.md      — description-always core rule
M skills/ignatius-modeling/references/templates.md       — description: in entity/group templates
M skills/ignatius-modeling/references/entity-flow.md     — description step
M skills/ignatius-modeling/references/dfd-authoring.md   — description step for processes/stores
M skills/ignatius-modeling/references/flow-templates.md  — description: in flow templates
M skills/ignatius-modeling/references/verification.md    — validate --index in the loop; reserved name
M skills/ignatius-modeling/references/conventions.md     — reserved index_file name
M docs/guides/folder-format.md           — routers, description:, index_file/harness config, --agents
M docs/guides/commands.md                — index section; --index on validate; exit codes
M docs/guides/validation.md              — Config rules and Index rules
M docs/guides/flows.md                   — description: on process, external, store
M docs/guides/modeling-skill.md          — verification loop covers validate --index
M docs/guides/getting-started.md         — command list names index
M README.md                              — command list and folder-format row
M docs/wiki/feature-map.md               — fill spec/guide/skill columns on the routing row
A models/*/**/index.md                   — 53 routers across key-inherited, orm-pure, orm-hybrid, llm-memory-db-mssql
M models/llm-memory-db-mssql/**          — description: on 74 files; AGENTS.md, CLAUDE.md, SKILL.md
```


## Outline


```
- src/router/region.ts
  - REGION_RE — locate a named <ignatius-*> block and its inner span
  - readRegion — extract inner content, or null when absent
  - replaceRegion — swap inner content in place, appending the block when absent
- src/router/fingerprint.ts
  - hashFile — SHA-256 of file bytes
  - folderDigest — hash of an ordered row-hash list
  - RouterNode — one row: name, kind, description, link, hash
- src/router/build.ts
  - buildRouters — model + folder tree → RouterFile[], one per organizing folder
  - buildDataTree / buildDataFolder — the data/ subtree from each entity's sourcePath, never its declared group
  - buildFlowFolder — one router per flow and sub-DFD folder
  - safeHashFile — hashes a target, collecting an unreadable one for index.unreadable_target
  - breadcrumbFor — the ↑ line for a given depth
  - renderTable — RouterNode[] → markdown table
- src/router/detect.ts
  - resolveHarness — config value plus ancestor probe → which guidance files to write
- src/router/agents.ts
  - deriveKeyStyle — key-inherited, orm-oriented, mixed, or undetermined, from PK shape and identifying edges
  - buildAgentsGuide — AGENTS.md body
  - buildClaudeShim — @AGENTS.md import plus Claude-specific lines
  - buildSkillMeta / buildSkillBody — YAML frontmatter (the one non-region write) plus body
  - writeGuidance — region-scoped writes of the three guidance files into the model root
- src/router/write.ts
  - writeRouters — region-scoped write per RouterFile, creating missing files; owns the breadcrumb and index regions
- src/model/parse.ts
  - config read — index_file, harness onto _meta
  - data-scan skip — basename equality against the resolved index_file
  - description — entity and group frontmatter passthrough
- src/model/validate.ts
  - config.index_file_ext / _path / _entity — config shape rules
  - index.stale / index.orphaned — router drift rules, Class assignment per Risks
- src/cli/cli.ts
  - indexCmd — path positional, --model, --agents
  - validateCmd — --index flag threading the router check
```


## Flows


1. **Generate routers** — user runs `ignatius index models/key-inherited` → the CLI resolves the model root and parses it → `buildRouters` walks the organizing folders and builds one `RouterFile` per folder, reading classification from the parsed model → `fingerprint` hashes each target and rolls digests up the ancestor path → `writeRouters` replaces each `<ignatius-index>` region in place, creating any missing `index.md` → the run reports how many routers were written.

2. **Edit an entity, then check** — user edits `data/transactional/Payment.md` → runs `ignatius validate --index` → validate parses the model once, recomputes hashes, and finds the stored digest on `data/transactional/index.md` no longer matches → an `index.stale` finding names that folder and its ancestors through `formatFindingsForStderr` → nothing is written → user runs `ignatius index` and the check passes.

3. **Regenerate without losing hand-authored rules** — user adds an `<ignatius-rules>` block to `data/identity/index.md` and adds a new entity to the group → runs `ignatius index` → the `<ignatius-index>` region gains the new row and a new digest; the `<ignatius-rules>` block, the heading, and the breadcrumb line are unchanged byte for byte.

4. **Write guidance and install it** — user runs `ignatius index --agents server/docs/data-model` → routers regenerate first → `resolveHarness` finds a `.claude/` directory above the model root and resolves to Claude → `AGENTS.md`, `SKILL.md`, and a `CLAUDE.md` importing `@AGENTS.md` land in the model root and nowhere else → an agent that later opens `data/transactional/Payment.md` picks up `CLAUDE.md` automatically → the user optionally runs `ln -s ../../server/docs/data-model .claude/skills/alkane-model` to make the skill invocable.

5. **Author an entity under the new rules** — user invokes the `ignatius-modeling` skill in entity mode → the skill asks for a one-line `description:` alongside the existing questions → it writes the entity file → its verification loop runs `ignatius validate --index`, which reports the routers as stale → the skill runs `ignatius index` and re-verifies.


## Risks


| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `index.stale` as Class B hard-fails anyone who edits an entity and validates before regenerating, turning a routine edit into a red build | Medium | Ship it Class B, since `--index` is opt-in and the fix is one command, but pin the behavior in `test-validate-index.ts` so the class is a deliberate, testable choice rather than an accident. Downgrade to A only if the loop proves noisy in practice. |
| Region writer corrupts a file it does not fully understand (nested tags, orphan or mismatched closers, CRLF) | Medium | `region.ts` is pure and unit-tested before any writer uses it (CP3 precedes CP4). A boundary is a `<ignatius-*>` tag at column 0 ending its line; anything else is text, and column-0 boundaries must pair by name or the writer throws with the line number and the fix. Tests cover every pairing error, CRLF, an indented example surviving inside a rules block, a column-0 example inside a rules block throwing, and a column-0 fake region with no sibling being replaced in place. |
| A markdown table inside an XML block renders as literal pipes when the blank lines are missing | Medium | The renderer always emits a blank line after the opening tag and before the closing tag; `test-router-index.ts` asserts both are present in generated output. |
| Digest churn: hashing raw bytes means a whitespace-only edit invalidates a digest and dirties a diff | Low | Accepted. Raw-byte hashing is the only rule that catches body edits, which are exactly what a stale description would miss. |
| Adding `src/router/` creates an unregistered wiki domain, so the signals map goes stale | Low | CP7 includes the feature-map row; a signals refresh after the range picks up the new directory. |
| The five in-repo model roots and five fixture roots gain generated files, inflating the diff and perturbing existing checks | Medium | CP4 generates into `models/key-inherited` only; the other roots stay untouched until the feature is green. Existing checks assert model parse results, not directory contents. |


## Change log


### 2026-09-05 — Initial spec

**What changed:** First contract for model index routing: per-folder routers with rolled-up digests, `index_file`/`harness` config, `description:` frontmatter, `ignatius index [--agents]`, `ignatius validate --index`, and the authoring-skill updates that keep the format teachable.

**Why:** A model root is navigable to the SPA and a flat pile of markdown to every other reader, so agents and humans glob the tree instead of descending it.


### 2026-09-05 — Reserved-name skip covers every scan, not just `data/`

**What changed:** SC2 now requires the reserved `index_file` skip in all five scans that can read a generated router: the `data/**/*.md` and `groups/*.md` scans in `src/model/parse.ts`, and the process, externals, and stores scans in `src/flows/flow-parse.ts`. It also pins that a second `ignatius index` run leaves stderr clean. The `parse.ts` and `flow-parse.ts` change-tree lines record the wider scope.

**Why:** Routers are written into `groups/`, `flows/<flow>/`, sub-DFD folders, `externals/`, and `stores/`, and each of those scans read the router back as a malformed definition file. A `groups/index.md` made every later `parseModels` throw. The remaining four produced `parse.invalid_yaml`, which is Class B, so once `validate --index` ships, running `ignatius index` would make `ignatius validate` exit 1 on any indexed model.

**Superseded:** SC2 previously scoped the skip to the `data/**/*.md` scan alone.


### 2026-09-05 — Correction: routers follow the folder tree, not declared groups

**What changed:** SC5 now says a router is written into every subdirectory of `data/` that holds entity files, at any depth, rather than into "each `data/<group>/`". New SC5a states that routers mirror the filesystem, that entity paths come from the parser's discovered path, and that the generator must not crash on a layout that does not use group-as-folder.

**Why:** `group:` is a declarative field, independent of where a file sits. Entities are discovered by a recursive `data/**/*.md` glob, so a model may keep them flat in `data/`, nested by group, or nested by something else entirely. Reconstructing a path as `data/<group>/<id>.md` produced an unhandled `ENOENT` from `hashFile` on `models/broken-demo`, whose entities are flat in `data/` while declaring `group: core`. Four of the five in-repo models happen to nest by group, which is why the assumption survived until a non-conforming model was indexed.

**Superseded:** SC5 previously enumerated `data/<group>/` as the only per-group router location, implying group and folder are the same thing.


### 2026-09-05 — Correction: `build.ts` does I/O

**What changed:** The change-tree annotation for `src/router/build.ts` reads "reads bytes to hash, never writes" rather than "pure".

**Why:** A digest has to exist before a table row renders, so the builder reads file bytes to hash them. Deferring that to `write.ts` would need a second pass over the tree. The contract the split actually buys is that one module writes, not that the builder is side-effect free.


### 2026-09-06 — Audit corrections

**What changed:** SC6 names the parser's actual classification set (`Independent`/`Dependent`/`Subtype`/`Associative`/`Classifier`). SC14 asks for no new type errors in touched files rather than a clean `tsc`, which the repo has never had. The change tree drops `src/types/index.ts`, which never existed, records that `writeGuidance` lives in `agents.ts`, adds `index.unreadable_target`, and lists the guides, README, skill reference, and model files the range touched. The Outline names the pieces that exist at HEAD.

**Why:** The final audit found six spots where the body described the plan rather than the code. A subagent reading the old Outline would look for `rowsForEntityGroup`, which was replaced when routers switched to mirroring the filesystem.

**Superseded:** SC6's `Reference` classification; SC14's `bunx tsc --noEmit exit 0`; the change tree's `src/types/index.ts` row and write.ts as the only fs-writing module; the Outline's group-as-folder row builders.


### 2026-09-06 — Region boundaries are position-based

**What changed:** A `<ignatius-*>` tag is a region boundary only when it starts at column 0 and ends its line; anywhere else on a line it is text. Column-0 boundaries must pair open and close by name; a nested opener, an orphan closer, a mismatched closer, an unclosed opener, or a duplicate region throws with the line number and the fix. The region-writer Risks row names these pairing errors and the three test premises that pin the rule. `validate --index` uses the same column-0 definition to decide whether a file is a router.

**Why:** Three successive patches tried to exempt code spans by their delimiters (fences, then inline backticks, then full containment) and each opened a new way for real markup to hide, twice as silent truncation behind a success exit. A delimiter can be accidental; a position cannot, and markdown pushes every prose container off column 0. One tokenizer and a pairing scan replace two scanners that could disagree about the same bytes.

**Superseded:** The fence exemption ("a region inside a fenced block must be ignored") and every inline-code exemption. A column-0 fake region with no real sibling is replaced in place rather than skipped.


## Implementation log


### built — 2026-09-06, draft PR #35

Built across 7 checkpoints of the /autopilot subagent loop, a post-loop pass from live user feedback, and one audit fix iteration. Squashed to a single commit for merge at the user's request, so the per-checkpoint history below is narrative rather than a SHA list.

- design doc + spec (loop base)
- CP1 `index_file`/`harness` config, basename scan skip, three config rules
- CP3 managed-region + fingerprint primitives, fail-loud on nested/unclosed/duplicate regions
- CP2 `description:` on all five file kinds
- reserved-name skip in all five scans; SC2 and design-doc amendments
- CP4 `ignatius index`, routers mirror the filesystem, breadcrumb region, Class B exit code
- CP5 `validate --index`, `index.unreadable_target` replaces a silent sentinel; CP7 skill + guide
- CP6 `index --agents` in-folder guidance
- routers committed into four demo roots
- key style derived structurally from PK shape
- root router section descriptions and model prose
- `test-validate-index` constructs never-indexed state explicitly
- `llm-memory-db-mssql` seeded with 74 descriptions and made the exemplar
- audit fix iteration: `LEGACY_CRUMB_RE` removed (SC8), four stale comments rewritten, `--agents` docs corrected, demo roots regenerated, spec amended; region boundaries redefined as column-0 tags with a pairing scan after three delimiter-based patches each opened a new hole

**Out-of-scope work performed during this build:**

- CP4 added the reserved-name skip to the `groups/` scan in `parse.ts`, outside its declared file list, because a `groups/index.md` made every later `parseModels` throw and blocked SC8. Flagged by the implementer, accepted, and the spec widened to match.
- Four demo roots indexed and `llm-memory-db-mssql` seeded with descriptions and guidance, from user feedback after the loop closed. The spec's Risks table had kept the in-repo roots untouched until green.

**Unforeseens — surprises that emerged during implementation:**

- Region detection required interior blank lines, so a well-formed hand-authored `<ignatius-rules>` block written without them was reported as an unclosed tag and hard-failed `ignatius index`. Blank lines are a CommonMark rendering requirement, not a parsing one; every test fixture used the generator's own convention. Found by probing `replaceRegion` directly.
- The region guard was patched three times after the audit and defeated three times. Each patch defined "prose about a tag" by its delimiters: the fence exemption, then inline backticks with text stripped before scanning, then inline spans with full containment. Each reviewer found bytes where the region matcher and the guard disagreed, and twice the result was silent truncation behind a success exit rather than the crash being fixed. A read-only strategist pass found the cause, two scanners over the same bytes, and a fourth live hole no reviewer had filed. The fix is a rule about position, not delimiters, because a delimiter can be accidental and a position cannot; it deletes the whole code-span apparatus.
- `build.ts` reconstructed entity paths as `data/<group>/<id>.md`. `group:` is declarative and independent of folder layout, so `models/broken-demo` (flat `data/`, `group: core`) crashed with an unhandled `ENOENT`. Four of five in-repo models nest by group, which hid it. `ModelNode` gained `sourcePath`.
- The crash fix wrapped hashing in a bare `catch` returning a stable all-zeros digest, so an unreadable target would have passed `validate --index` forever. Replaced with `index.unreadable_target`.
- Key style needed two corrections. Edge identifying-ness produced `mixed` for `key-inherited` because edges into catalog tables are non-identifying in both styles. The replacement counted only a PK named exactly `id` as surrogate, so `llm-memory-db-mssql` (surrogates named `<entity>_id`) read as pure key-inherited. The structural rule uses identifying edges per entity plus a 20% share threshold for `mixed`.
- The Class A/B tier is inert for `GlobalError`s: `cli.ts` filters flow errors by class but counts every global error toward the exit code. The new config rules were the first class-A globals and would have hard-failed while claiming to warn. Reassigned to B.
- Committing routers into `models/key-inherited` broke `test-validate-index.ts`, which copied that model and assumed it had no routers. The spec's Risks table had named this hazard; the mitigation was dropped once the feature was green. A stale `dist/ignatius` masked it on the first run and a hung Playwright check masked it on the second, so the demo-roots commit was pushed without a green suite.
- The root-router change (section descriptions, model prose) did not regenerate the committed demo routers, so `key-inherited`, `orm-pure`, and `orm-hybrid` sat behind the generator until the audit caught it. `validate --index` cannot see this class of drift because the digest hashes child digests, not rendered text. The same commit's message claimed the root digest changed; it did not.
- Five agent claims did not survive verification, each attributing a real signal to noise or to another agent: a "flaky" suite that was green, a "new" typecheck error that was pre-existing, a "flaky" router failure that was a concurrent edit, a "pre-existing" fixture failure that was a regression from this branch, and a "writes routers then exits 1" that was a crash. Direct probing, not the suite, found every substantive defect above.

**Deferred items still open:**

- `ignatius index` reports an unreadable target only through `validate --index`, not from the index verb itself.
- Symlinks into `.claude/skills/` are verified only for a relative link within one repo; an absolute link to a model outside the repo is untested.
- `key-inherited`, `orm-pure`, and `orm-hybrid` are indexed without descriptions or guidance files, so they show structure but not payload.
