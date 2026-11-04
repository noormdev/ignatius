# Wiki-style entity links — implementation contract


Derived from `docs/design/wiki-entity-links.md`.


## Module: `src/wikilink.ts`


- `splitWikiTarget(inner: string): { target: string; label: string }` — splits on the first `|`; both sides trimmed; an empty label falls back to the target.
- `wikiLinkPlugin(md): void` — registers an inline rule `before('link', 'wikilink', …)` so code spans (tokenised by the earlier `backticks` rule) and fenced code stay literal.
- `WikiLinkEnv = { knownIds?: Set<string>; links?: string[] }` — render-time context passed via `md.render(src, env)`.
- `targetCandidates(target): string[]` — the ids a target may name, in order: the target, then the target with each run of whitespace replaced by `-` (a file name is its title with hyphens).
- `canonicalTarget(target, knownIds): string | null` — the first candidate in `knownIds`, or null.
- `linkStateNeutral(html): string` — rewrites every live anchor and missing span as a live anchor on its hyphenated target, so change review compares two renders of one body equal whichever targets exist.


`parseModels` passes `knownIds` = the entity ids plus the flow node ids, which are the file names under `flows/**`, `externals/`, and `stores/` (index files excluded). A link that resolves to a flow node renders live and is left out of `bodyLinks`, so `body.unknown_link` (title "Unknown link target", message ``[[<target>]] names no entity, process, external, or store.``) flags only targets nothing names.

Rule behaviour, on a `[[…]]` span with no nested `[`, `]`, or newline and a non-empty target:


- Resolves the target with `canonicalTarget(target, knownIds)`: the target itself when it is a known id, else the target with each run of whitespace replaced by `-` when that is a known id, else null. Absent `knownIds` → optimistic: the target, never missing.
- Pushes the resolved id (the raw target when unresolved) onto `env.links` (when present).
- Emits a single `html_inline` token:
  - resolved → `<a class="entity-link" data-entity="<resolved id>" href="#entity-<resolved id>"><label></a>`
  - missing → `<span class="entity-link entity-link--missing" title="Unknown entity: <target>"><label></span>`
- `target` and `label` are escaped via `md.utils.escapeHtml`.


markdown-it 14 ships no types in this repo; the rule types the state/instance members it touches via local interfaces, not `any`.


## Parser: `src/parse.ts`


- `md.use(wikiLinkPlugin)` once at module load.
- `ModelNode` gains `bodyLinks?: string[]` — entity ids referenced via `[[…]]`, in source order.
- `RawNode` carries the raw `body` string; `bodyHtml`/`bodyLinks` are NOT set during the scan loop.
- Final node assembly renders each body in a second pass: `const env = { knownIds, links: [] }; bodyHtml = md.render(rawNode.body, env); bodyLinks = env.links;` where `knownIds = new Set(rawNodes.map(n => n.id))`.
- Group descriptions are still rendered without `env` (parsed before ids exist) — their links render optimistically.


## Validator: `src/validate.ts`


- `RuleId` gains `'body.unknown_link'`; `RULES` gains its entry (`class: 'A'`, not `liveOnly`).
- `checkBodyLinks(node, nodeIds): EntityError[]` — one `body.unknown_link` warning per **distinct** unknown target in `node.bodyLinks`; `severity: 'warning'`; `entityId` is the linking node.
- Called in the entity-rules loop alongside the other Class A checks. `nodeIds` is the existing `new Set(model.nodes.map(n => n.id))`.


## Graph surface: `src/App.tsx`


- The modal `.doc-body` div gets an `onClick` delegation handler: narrow `e.target` with `instanceof Element`, `closest('a[data-entity]')`, `preventDefault()`, then `onNavigate(id)` when the id is an entity or a flow node — reusing the FK-link navigation path. No casts.
- A link to a flow node leaves the entity dialog, and Back reopens it (`followFlowLink` in `App.tsx`). A decomposed process opens its sub-DFD. Another process opens the diagram it is drawn in with its dialog, as one history entry; in the Flows view its dialog opens over the diagram on screen. An external or store opens its Dictionary section, or in the Flows view its dialog.


## Styling


- `.entity-link` and `.entity-link--missing` in both `src/styles.css` (graph) and the dict inline CSS (`src/generators/dict.ts`). Valid: link colour + underline border. Missing: muted colour, `cursor: not-allowed`, dashed border.


## Findings flow


`body.unknown_link` is an `EntityError` and rides the existing finding surfaces unchanged: CLI stderr (Class A, not live-only → appears), dict findings panel + per-entity ⚠ disclosure, graph findings panel + modal Issues section.


## Column descriptions


A column's `desc` renders as inline markdown (`md.renderInline`) into `ColumnDef.descHtml`, with the same `env` as its entity's body, so its `[[links]]` resolve against the same ids, feed the same `bodyLinks`, and raise the same `body.unknown_link` finding. `desc` stays the raw text that search and change review read. `ColumnsTable` renders `descHtml` and routes a link click like a body link: in the Dictionary through the section and diagram rules below, in an entity dialog through the entity-dialog rules above.


## Client-side resolution


Bodies rendered with entity-only `knownIds` (entities) or none (flow bodies) are resolved again in the viewer, once every node id is known.

- `upgradeMissingLinksInContainer(container, allKnownIds)` (`src/app/dom/body-links.ts`) points each live anchor's `data-entity` at `canonicalTarget(raw, allKnownIds)` when that differs from the raw target, and replaces each missing span whose target resolves with a live anchor on the resolved id.
- `buildFlowDocResolver` (`src/app/logic/doc-resolver.ts`) tries each `targetCandidates` id for a bare token, in the order entity, decomposed process, process, external, store. A process that owns a sub-DFD resolves to `{ kind: 'diagram', diagramRef }`, the `dfd=` reference `diagramRef` (`src/flow-view/flow-nav.ts`) builds for that sub-DFD; the Flows view and the Dictionary open that diagram. A `proc:` token resolves to the process node, carrying `inDiagramRef` (the diagram it is drawn in) and, when the process is decomposed, `diagramRef`. Its Dictionary section shows **Show in diagram** and **Open sub-diagram** for them; a process dialog in Flows shows only **Open sub-diagram**.


## Tests


- `test/checks/test-wikilink.ts` — `splitWikiTarget`; rendered HTML for valid / aliased / missing / optimistic; code-span + fence literals; HTML escaping; standard markdown links untouched; `env.links` collection.
- `test/checks/test-validate-body-links.ts` — `validateModel` emits `body.unknown_link` for unknown targets, dedupes repeats, stays silent when all resolve or `bodyLinks` is absent.
- Sample-model pins updated for the dogfooded broken link (`broken-demo/Order.md` → `[[Cart]]`): `test-validate-refs` (+`body.unknown_link: 1`), `test-api-model` (entityErrors 8→9), `test-findings-panel` (12→13), `test-cli-stderr` + `test-cli-validate` (warn lines 7→8). `key-inherited` stays clean (0 findings — all dogfooded links resolve).


## Change log


### 2026-06-01 — Initial


**What changed:** Added `[[Entity]]` / `[[Entity|label]]` body links. New `src/wikilink.ts` inline rule; deferred body render in `parse.ts` with `ModelNode.bodyLinks`; `body.unknown_link` validator rule; graph click delegation; dict native-anchor nav; `.entity-link` styles in both surfaces. Dogfooded into all four sample models (`broken-demo` carries one intentional broken link).


### 2026-11-03 — Titles resolve to ids; links to decomposed processes open the sub-DFD


**What changed:** A target resolves through `canonicalTarget`, so `[[Answer Turn]]` names the process `Answer-Turn` (a file name is its title with hyphens). The renderer, the client upgrade pass `upgradeMissingLinksInContainer` (which now also rewrites live anchors to the resolved id), and the flow doc resolver all apply it. In the flow doc resolver, a bare token naming a process that owns a sub-DFD resolves to `{ kind: 'diagram', diagramRef }`, and the Flows view and Dictionary open that diagram; a `proc:` token from a node's ⓘ badge still opens the process dialog, which links to the diagram.

**Why:** Process tables written with titles (`[[Answer Turn]]`) rendered links that went nowhere, and a link to a decomposed process opened its dialog instead of its diagram.

**Superseded:** a target resolved only on an exact id match.


### 2026-11-04 — Links in column descriptions


**What changed:** Column `desc` renders as inline markdown with `[[links]]` into `descHtml`.

**Why:** A link written in a column description rendered as literal brackets.


### 2026-11-04 — Links to flow nodes are known at parse time


**What changed:** `parseModels` adds process, external, and store ids (file names) to `knownIds`, and drops links that reached them from `bodyLinks`. The rule is titled "Unknown link target" and its message names the target and what it failed to match.

**Why:** An entity body or column description linking a process raised a false `body.unknown_link` warning, worded as if only entities could be linked.

**Superseded:** `knownIds` held entity ids only; flow-node links were upgraded client-side and warned on.


### 2026-11-04 — Entity dialogs follow links to flow nodes


**What changed:** An entity dialog in the Graph or Flows view follows a link to a process, external, or store (body or column description) as described under Graph surface; Back reopens the dialog.

**Why:** Once flow-node links rendered live, clicking one in an entity dialog did nothing.

**Superseded:** an entity dialog followed links to entities only.

