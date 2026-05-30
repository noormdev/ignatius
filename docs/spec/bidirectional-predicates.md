# Spec: bidirectional edge predicates


Design: `docs/design/bidirectional-predicates.md`. Implements follow-up `bidirectional-edge-predicates`.


## Contract summary


`ModelEdge.predicate` changes from `string` to `{ fwd: string; rev: string }`. The parser normalizes both authoring forms into that shape. The graph viewer labels edges with `fwd` by default and swaps incident edges to `rev` on node hover. Static surfaces (dict, entity modal) show `fwd` primary + `rev` secondary. `key-inherited` gains authored `fwd`/`rev` pairs.


## Types (`src/parse.ts`)


- `Predicate` (new exported type): `{ fwd: string; rev: string }`.
- `ModelEdge.predicate`: `string` → `Predicate`.
- `Frontmatter.relationships[].predicate`: `string` → `string | { fwd?: string; rev?: string }`.
- `RawEdge.predicate`: carry the normalized `Predicate` (normalize at the point edges are pushed, not later).


## Normalization rule (`src/parse.ts`)


When building each `RawEdge` from a frontmatter relationship, normalize `rel.predicate`:

- `typeof rel.predicate === 'string'` → `{ fwd: rel.predicate, rev: rel.predicate }`.
- object → `{ fwd: rel.predicate.fwd ?? '', rev: rel.predicate.rev ?? '' }`.
- `null`/`undefined` → `{ fwd: '', rev: '' }`.

Do this with a small named helper (e.g. `normalizePredicate(raw): Predicate`). No `as` casts — narrow with `typeof`/`isRecord`.


## Graph viewer (`src/App.tsx`)


### Edge element data (the `model.edges` loop, ~line 997)


Each real relationship edge element's `data` gains:

- `predicateFwd: edge.predicate.fwd`
- `predicateRev: edge.predicate.rev`
- `edgeLabel: edge.predicate.fwd` (the live label field, initialized to fwd)

Cluster/joiner edge elements (the `predicate: ''` ones) set `edgeLabel: ''` and omit fwd/rev (or set both `''`).


### Edge label style (~line 216)


Change `'label': 'data(predicate)'` → `'label': 'data(edgeLabel)'`.


### Longest-predicate layer spacing (~line 1014)


`longestPredicate` must use the rendered (fwd) length: `Math.max(max, e.predicate.fwd.length)`. (Using fwd keeps spacing matched to the default label.)


### Hover handlers (new)


After the graph is built and `cy` exists, register:

- `cy.on('mouseover', 'node', evt => ...)`: for `evt.target.connectedEdges()`, if `edge.target().id() === evt.target.id()` (hovered node is the child end) set `edge.data('edgeLabel', edge.data('predicateRev'))`; otherwise leave at fwd. Skip edges whose `predicateRev` is undefined (cluster/joiner edges).
- `cy.on('mouseout', 'node', evt => ...)`: for `evt.target.connectedEdges()`, restore `edge.data('edgeLabel', edge.data('predicateFwd'))` when `predicateFwd` is defined.

Handlers must survive live SSE reloads the same way existing handlers do (registered in the same effect that builds `cy`). No graph rebuild on hover — only `edge.data()` mutation.


### Entity modal relationships table (~line 435)


`<td>{edge.predicate}</td>` → render `fwd` primary and `rev` secondary, e.g.:

    <td>{edge.predicate.fwd}<span className="predicate-rev">{edge.predicate.rev}</span></td>

Only render the `rev` span when `rev` differs from `fwd` (string-fallback edges have them equal — show one). Add a minimal `.predicate-rev` style (muted, smaller) in `src/styles.css` consistent with existing muted text.


## Data dictionary (`src/generators/dict.ts`, ~line 106)


`${esc(e.predicate)}` → `${esc(e.predicate.fwd)}` plus a muted secondary `rev` when `rev !== fwd`. Match the existing dict cell markup/classes; no new external deps.


## Test fixtures to update (typecheck breakers)


These build `ModelEdge` literals with string predicates — update to the new shape:

- `test/checks/test-validate-refs.ts` — edges at ~lines 59, 83, 110, 138: `predicate: 'references'` → `predicate: { fwd: 'references', rev: 'references' }` (and `'belongs to'` likewise). Wording is irrelevant to these ref-validation assertions; keep fwd=rev.
- `test/checks/test-dict-findings.ts` — `edgeA.predicate: 'placed by'` → `{ fwd: 'places', rev: 'placed by' }`.


## New parser test


Add `test/checks/test-parse-predicate.ts` (raw assertion script, PASS/throw style matching the other checks). It must verify, by calling `parseModels` on a tiny tmp fixture **or** by unit-asserting `normalizePredicate` if exported:

1. Object form `{ fwd, rev }` → `edge.predicate.fwd`/`.rev` preserved exactly.
2. String form → `fwd === rev === string`.
3. Missing `fwd` in object form → `fwd === ''`, `rev` preserved.

Prefer driving it through `parseModels` against a fixture dir under `tmp/` (per project convention: tests run against `tmp/`). Wire it so it runs in the `bun run test` glob (`test/checks/*.ts`).


## Model authoring (`models/key-inherited/`)


For every `relationships[].predicate` in `models/key-inherited/`, replace the string with `{ fwd, rev }`, lifting wording from `test/fixtures/sample_model.yaml` (same logical model). Pairs available there include:

- `classifies` / `is classified by`
- `is realized as` / `is a`
- `holds` / `identifies` (and `holds` / `is held by`)
- `settles` / `is settled by`, `is settled via` / `settles`
- `places` / `is placed by`
- `contains` / `is part of`
- `owes on` / `is owed by`
- `is sold via` / `sells`, `is billed via` / `bills`
- `applies to` / `is paid by`

Where a relationship has no exact match in the fixture, author a sensible parent→child `fwd` and child→parent `rev` consistent with the existing string (the existing string is the child-perspective `rev`). Do not touch `orm-hybrid`, `orm-pure`, or `broken-demo`.


## Checkpoints


| # | Checkpoint | Verify |
|---|------------|--------|
| 1 | `Predicate` type + `ModelEdge`/`Frontmatter` updated; `normalizePredicate` populates `RawEdge`/`ModelEdge`. | `bunx tsc --noEmit` advances past parse.ts; new parser test passes. |
| 2 | Test fixtures (`test-validate-refs`, `test-dict-findings`) updated to object shape. | Both checks pass under `bun run test`. |
| 3 | dict + entity-modal render fwd primary / rev secondary; `.predicate-rev` style added. | dict checks pass; `bun run build:bundle` succeeds. |
| 4 | Graph edge data carries `predicateFwd`/`predicateRev`/`edgeLabel`; label style uses `data(edgeLabel)`; hover handlers swap per D3; longest-predicate uses fwd. | bundle builds; manual/visual: hovering a child entity flips its incident edge labels to rev, mouseout restores fwd. |
| 5 | `key-inherited` relationships authored with `{ fwd, rev }`. | `./dist/ignatius dict models/key-inherited` exits 0 (0 findings preserved); parse still yields 9 nodes baseline-equivalent. |
| 6 | Full suite + typecheck. | `bun run build:cli && bun run test` exits 0; `bun run typecheck` shows no *new* errors beyond the 6 pre-existing parse.ts ones (follow-up `parse-ts-preexisting-tsc-errors`). |


## Definition of done


- `bun run build:cli` succeeds; `bun run test` exits 0.
- Hovering a child entity in the live viewer flips its incident edge labels to the reverse predicate; mouseout restores forward. (Captured via the existing screenshot harness.)
- `key-inherited` authored with both predicates; other models unchanged and still parse.
- No `as` casts, no `any`. New behavior covered by `test-parse-predicate.ts`.


## Change log


### 2026-05-30 — Initial spec


**What changed**: New spec for bidirectional edge predicates — `ModelEdge.predicate` becomes `{ fwd, rev }`, parser normalizes string + object forms, graph viewer renders fwd by default and swaps to rev on hover (per-node-perspective), static surfaces show both, `key-inherited` authored with real pairs.

**Why**: Implements follow-up `bidirectional-edge-predicates`; edge labels currently read backwards relative to the parent→child layout flow.
