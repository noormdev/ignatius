# Wiki-style entity links — implementation contract


Derived from `docs/design/wiki-entity-links.md`.


## Module: `src/wikilink.ts`


- `splitWikiTarget(inner: string): { target: string; label: string }` — splits on the first `|`; both sides trimmed; an empty label falls back to the target.
- `wikiLinkPlugin(md): void` — registers an inline rule `before('link', 'wikilink', …)` so code spans (tokenised by the earlier `backticks` rule) and fenced code stay literal.
- `WikiLinkEnv = { knownIds?: Set<string>; links?: string[] }` — render-time context passed via `md.render(src, env)`.


Rule behaviour, on a `[[…]]` span with no nested `[`, `]`, or newline and a non-empty target:


- Pushes the target onto `env.links` (when present).
- `missing = env.knownIds ? !env.knownIds.has(target) : false` (absent `knownIds` → optimistic, never missing).
- Emits a single `html_inline` token:
  - valid → `<a class="entity-link" data-entity="<target>" href="#entity-<target>"><label></a>`
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


- The modal `.doc-body` div gets an `onClick` delegation handler: narrow `e.target` with `instanceof Element`, `closest('a[data-entity]')`, `preventDefault()`, then `onNavigate(id)` when the id resolves to a node — reusing the FK-link navigation path. No casts.


## Styling


- `.entity-link` and `.entity-link--missing` in both `src/styles.css` (graph) and the dict inline CSS (`src/generators/dict.ts`). Valid: link colour + underline border. Missing: muted colour, `cursor: not-allowed`, dashed border.


## Findings flow


`body.unknown_link` is an `EntityError` and rides the existing finding surfaces unchanged: CLI stderr (Class A, not live-only → appears), dict findings panel + per-entity ⚠ disclosure, graph findings panel + modal Issues section.


## Tests


- `test/checks/test-wikilink.ts` — `splitWikiTarget`; rendered HTML for valid / aliased / missing / optimistic; code-span + fence literals; HTML escaping; standard markdown links untouched; `env.links` collection.
- `test/checks/test-validate-body-links.ts` — `validateModel` emits `body.unknown_link` for unknown targets, dedupes repeats, stays silent when all resolve or `bodyLinks` is absent.
- Sample-model pins updated for the dogfooded broken link (`broken-demo/Order.md` → `[[Cart]]`): `test-validate-refs` (+`body.unknown_link: 1`), `test-api-model` (entityErrors 8→9), `test-findings-panel` (12→13), `test-cli-stderr` + `test-cli-validate` (warn lines 7→8). `key-inherited` stays clean (0 findings — all dogfooded links resolve).


## Change log


### 2026-06-01 — Initial


**What changed:** Added `[[Entity]]` / `[[Entity|label]]` body links. New `src/wikilink.ts` inline rule; deferred body render in `parse.ts` with `ModelNode.bodyLinks`; `body.unknown_link` validator rule; graph click delegation; dict native-anchor nav; `.entity-link` styles in both surfaces. Dogfooded into all four sample models (`broken-demo` carries one intentional broken link).
