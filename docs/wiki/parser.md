---
type: Domain
description: Parses an ignatius model root (data/, groups/, ignatius.yml) into a typed Model, derives classification/cardinality, and builds O(1) lookup indices.
---

# parser

## What it does

Reads a model root directory and produces a `Model`: entity nodes, edges, groups, subtype clusters, theme, and branding. Derives entity classification, edge `identifying`, and cardinality from structure rather than trusting hand-authored values. Renders entity body markdown (including `[[wiki-links]]`) to HTML at parse time. Builds precomputed lookup maps (`ModelIndex`) for O(1) access to nodes, edges, keys, and clusters.

## CLI code

- [`src/model/parse.ts`](../../src/model/parse.ts) (427L) — exports `parseModels(dir): Promise<ParseResult>` where `ParseResult = { model: Model; globalErrors: GlobalError[] }`. Reads `ignatius.yml` for `_meta` (name/version/desc/updated/flowRules), `theme:` (via `mergeTheme()`), and `branding:` (via `mergeBranding()`). Scans `data/**/*.md` for entity files (frontmatter + body) and `groups/*.md` for group definitions. Exports `normalizePredicate()`, `ModelNode`, `ModelEdge`, `Model`, `Predicate`, `ColumnDef`, `SubtypeCluster`, `GroupConfig`, `Cardinality`, and `ModelMeta` types.
- [`src/model/wikilink.ts`](../../src/model/wikilink.ts) (98L) — exports `WikiLinkEnv`, `splitWikiTarget()`, and `wikiLinkPlugin(md)`, a markdown-it inline rule for `[[Target]]` / `[[Target|label]]` syntax. Registered onto the shared `MarkdownIt` instance in `parse.ts` via `md.use(wikiLinkPlugin)`.
- [`src/model/model-index.ts`](../../src/model/model-index.ts) (222L) — exports `buildModelIndex(model: Model): ModelIndex` and `endpointKey(source, target): string`. Pure module (no Bun/Node/DOM imports), browser-safe.

## Docs

- [`docs/design/folder-model.md`](../design/folder-model.md) / [`docs/spec/folder-model.md`](../spec/folder-model.md) — the `data/`/`flows/`/`groups/`/`externals/`/`stores/` folder-root format `parseModels` scans.
- [`docs/design/wiki-entity-links.md`](../design/wiki-entity-links.md) / [`docs/spec/wiki-entity-links.md`](../spec/wiki-entity-links.md) — the `[[…]]` wiki-link syntax implemented in `wikilink.ts`.
- [`docs/spec/derive-classification.md`](../spec/derive-classification.md) — the 5-rule classification and `identifying`-derivation contract implemented in `parse.ts`.
- [`docs/design/bidirectional-predicates.md`](../design/bidirectional-predicates.md) / [`docs/spec/bidirectional-predicates.md`](../spec/bidirectional-predicates.md) — the `{ fwd, rev }` predicate shape implemented by `normalizePredicate()`.
- [`docs/guides/folder-format.md`](../guides/folder-format.md) — user-facing guide to the folder root format.
- [`docs/guides/predicates.md`](../guides/predicates.md) — user-facing guide to bidirectional predicates.

## Coupling

- `validate` — two-way type coupling: `parse.ts` imports `GlobalError` from [`src/model/validate.ts`](../../src/model/validate.ts), and `validate.ts` imports `Model`/`ModelNode`/`ModelEdge`/`SubtypeCluster` from `parse.ts`. `model-index.ts` documents mirroring `validate.ts`'s `checkAlternateKeys` (AK column union) and `checkEdgeDanglingFkColumn` (FK column derivation from `edge.on` keys) logic — a change to either derivation must be kept in sync in both files.
- `flows` — [`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts) imports `Model` from `parse.ts`; [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts) imports `wikiLinkPlugin` from `wikilink.ts` directly (its own markdown-it instance, separate from the one in `parse.ts`). Both instances pass the same `highlight` callback, so entity and flow bodies highlight identically.
- [`src/model/markdown-highlight.ts`](../../src/model/markdown-highlight.ts) — shiki with six precompiled grammars (json, sql, javascript, typescript, python, bash) behind `createJavaScriptRawEngine()`, exported as `highlightCodeFence(code, lang)` and wired into both `MarkdownIt` constructors as the `highlight` option. Returns `''` on an untagged fence, an unbundled language, or a grammar throw, which hands the block back to markdown-it's default escaping. Server-side only: app code imports `parse.ts` for types alone, so neither markdown-it nor these grammars reach the browser bundle — the browser's own highlighter, [`src/app/logic/json-highlight.ts`](../../src/app/logic/json-highlight.ts), loads the json grammar by itself for the same reason.
- `frontend` ([`src/app/`](../../src/app)) — multiple modules under [`src/app/logic/`](../../src/app/logic) and [`src/app/hooks/`](../../src/app/hooks) import `Model`, `ModelNode`, `ModelEdge`, `Predicate`, `ThemeConfig`, or `SubtypeCluster` as types from `parse.ts`; `spotlight.ts` and `spotlight-inherited.ts` import `ModelIndex` from `model-index.ts`. `GroupConfig` is imported from `parse.ts` only outside `logic/`/`hooks/`, by [`src/app/App.tsx`](../../src/app/App.tsx), [`src/app/components/ui/FabMenu.tsx`](../../src/app/components/ui/FabMenu.tsx), and [`src/app/views/graph/styles.ts`](../../src/app/views/graph/styles.ts).
- `server` ([`src/server/server.ts`](../../src/server/server.ts)) and `cli` ([`src/cli/cli.ts`](../../src/cli/cli.ts)) both call `parseModels()` directly to produce the `Model` they serve or output.
- `generators` ([`src/generators/app.ts`](../../src/generators/app.ts)) imports the `Model` type from `parse.ts`.
- Changing the `Model`, `ModelNode`, `ModelEdge`, or `ModelIndex` shapes forces updates across all of the above; changing `ignatius.yml` top-level key handling in `parseModels` forces updates to `theme` and `branding` default-merge logic in [`src/theme/`](../../src/theme).

## Conventions worth knowing

- Two-pass body rendering: `ModelNode.bodyLinks` and `bodyHtml` are rendered in a second pass after every entity id is known, so `[[…]]` links resolve against the full id set and unknown targets render as `entity-link--missing` spans instead of being silently dropped.
- Classification is derived, not authored: `classification` field in frontmatter is legacy (`legacyClassification`, used only as a Classifier signal alongside the `reference: true` flag); the parser always runs the 5-rule order (Classifier → Subtype → Associative → Dependent → Independent) rather than trusting a hand-written value.
- `identifying` per edge is derived from whether every FK child column in `edge.on` is present in the child node's `pk` — never hand-authored despite the `Frontmatter.relationships[].identifying` field existing for backward compat.
- `deriveCardinality()` treats a `Subtype` classification specially (`{ parent: '1', child: '0..1' }` for identifying edges) before falling through to PK/AK-based cardinality rules.
- `ModelIndex` maps do not survive JSON serialization; `buildModelIndex()` must be called fresh wherever a `Model` enters a consumer (after `parseModels`, after an SSE `model-changed` event, after reading a static global) rather than being attached to a serialized payload.
- `akColumnsByNode` and `fkColumnsByNode` in `ModelIndex` are absent (not empty-Set) for nodes with no alternate keys / no outgoing edges, respectively — callers must check for map-key presence, not just Set size.
- `subtypeMemberToCluster` is first-wins for members appearing in multiple clusters; `clustersByMemberId` is the array form that captures all of them.
- `wikilink.ts` types markdown-it's state/instance via minimal local interfaces (`InlineToken`, `InlineState`, `MarkdownItLike`) rather than casting to `any`, because markdown-it 14 ships no types in this repo.
