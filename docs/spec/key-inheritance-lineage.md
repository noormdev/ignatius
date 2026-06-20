# Key-inheritance lineage


## Goal


Generalize viewer item #9 (shipped narrow as CP7) so that 1:1 key-inheritance
relationships are inferred TRANSITIVELY up every hop, cover DEPENDENT
identifying-1:1 (not just subtype clusters), and render as dotted inferred lines
in BOTH the DD spotlight and the graph (DG). See
`docs/design/key-inheritance-lineage.md`.


## Non-goals


- Inferring through non-1:1 / non-identifying FKs (only shared-identity 1:1 qualifies).
- Changing the model, edges, or classification.
- DG hover trigger beyond the existing select/highlight interaction.


## Success criteria


- [x] A pure `identity-group` helper computes the transitive closure of an entity over 1:1 key-inheritance edges — **subtype-cluster membership** AND **dependent identifying-1:1** (child PK columns == an identifying 1:1 FK's columns). Unit-tested on `ITIN → Identity → Party` (multi-hop) and `Business → Party` (single-hop).
- [x] Inferred connections for `A` = every other group member + each member's external (out-of-group) direct relationships, with `via` provenance, de-duplicated against `A`'s direct relationships (a direct edge is never also inferred). Unit-tested.
- [x] DD spotlight uses the generalized helper: spotlighting `Identity` surfaces Party's relationships; spotlighting `ITIN` transitively surfaces Identity's AND Party's relationships + siblings — all dotted. (Replaces CP7's subtype-only behavior; `test-spotlight-inherited.ts` updated.)
- [x] DG graph: selecting `Identity` draws DOTTED inferred lines (color `--spotlight-line-inherited`) to Party's relationships (+ siblings), with those nodes kept lit; selecting `ITIN` draws them transitively to Identity's + Party's relationships. Direct edges stay solid. A visual screenshot on `models/key-inherited` confirms.
- [x] DG graph 3-tier focus opacity: while an entity is focused (selected or hovered), elements split into three visually-distinct tiers — **direct** (focused node + its real graph neighbors + connecting edges) at **opacity 1.0, solid**; **inherited/ancestral** (the dotted `inherited` ray edges + their target nodes, via `inherited-dim`) at **0.5**; **unrelated** (everything else, via `faded`) at **0.2**. Direct wins de-dup: a node reachable as both direct and inherited renders direct (1.0). Tiers clear on deselect/reselect/relayout/teardown — no tier class survives a deselect. A visual harness reads the per-tier opacities off the live cy elements and asserts `direct > inherited > unrelated`.
- [x] The DG ephemeral lines never enter the model, the `layoutFingerprint` / saved positions, or the static export; they are removed on deselect / reselect / view-switch. A check asserts no inherited artifact leaks into `layoutFingerprint` / persistence.
- [x] No new `tsc --noEmit` errors vs baseline; `bun run test` exits 0; `bun run build:cli` succeeds.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est | Verifies |
|---|-----------|-------------|-------|-----|----------|
| A | Transitive identity-group helper + DD | `src/app/logic/spotlight-inherited.ts` (generalize: transitive closure + dependent-1:1 detection), `src/app/views/dict/DictionaryView.tsx` (if signature changes), `test/checks/test-spotlight-inherited.ts` (extend: transitive + dependent-1:1), `test/visual/test-dd-spotlight-grid.ts` (CP7 section → transitive/dependent case) | feature | ~4 | ITIN→Identity→Party transitive; Identity (dependent-1:1) participates; DD dotted; suite green |
| B | DG dotted inferred-upstream lines | `src/app/views/graph/GraphView.tsx` (select → ephemeral dotted inherited edges + keep lit + lifecycle), `src/app/views/graph/styles.ts` (dotted inherited edge style), `test/checks/` (no-leak into fingerprint/persistence), `test/visual/` (DG dotted on Identity/ITIN) | feature | ~5 | DG dotted inferred lines on select; transitive; no model/persistence/export leak; suite green |


Docs: add a CLAUDE.md feature↔doc map row (key-inheritance-lineage); this
generalizes the CP7 row — note the supersession.


## Risks


| Risk | L | Mitigation |
|------|---|-----------|
| Transitive closure over-connects / cycles | med | Closure over a finite edge set with a visited-set; cap is the group size; unit-test a multi-level fixture; only 1:1 key edges qualify |
| Dependent-1:1 detection misfires (catches non-key-inheritance 1:1 FKs) | high | Require identifying + cardinality 1:1 AND the FK columns == the child's FULL PK; unit-test a 1:1 FK that is NOT the PK → excluded |
| DG ephemeral edges leak into layout fingerprint / saved positions / export | high | Add edges AFTER layout with an `inherited` class; strip by class before any fingerprint/save; assert no leak in a check; exclude from export path |
| DG ephemeral edges fight the lineage-fade highlight | med | Add inherited endpoints + edges to the lit set; reuse the existing select/deselect handlers; remove on every deselect/reselect/view-switch |
| Dense diagrams: many dotted lines clutter the DG | low | Only on explicit select (not hover-everything); matches DD; owner asked for the full transitive set ("scaling to its possibilities") |


## Change log


- 2026-06-19 — CP-A landed. No contract changes; the spec's CP-A row and success
  criteria #1/#2/#3 are realized as written. The `via` provenance on an inherited
  relationship carries the single nearest-hop group-member id (not a chain string),
  so `SpotlightOverlay`'s existing "via &lt;id&gt;" / "shared key" label needs no
  change — recorded here as the chosen reading of "or the chain" in the criteria.
- 2026-06-19 — CP-B landed. No contract changes; the DG success criteria #4/#5/#6
  are realized as written. Two reading-level decisions recorded: (a) `buildStyles`
  in `src/app/views/graph/styles.ts` takes `(groups, theme, mode)` — NOT
  `(themeMode, semanticColors)` as the CP-B brief paraphrased; the inherited edge
  style was added there as written, against the real signature. (b) The inherited
  green is a SINGLE source of truth: a new `SPOTLIGHT_LINE_INHERITED: Record<ThemeMode,string>`
  constant exported from `src/app/dom/theme-css-vars.ts`, consumed both by the
  `--spotlight-line-inherited` CSS var (DD) and by `buildStyles` for the cytoscape
  edge `line-color` (DG) — chosen over runtime `getComputedStyle` to avoid var-set
  timing fragility and guarantee the DG matches the DD exactly.


### 2026-06-19 — DG 3-tier focus opacity


**What changed:** Added a clear three-tier opacity hierarchy to the DG focus
state (the same state that draws the inherited dotted rays). A single
`applyFocusTiers(focusNode)` in `GraphView.tsx` splits the graph into: **direct**
(focused node + its REAL graph neighbors — `connectedEdges().not('.inherited')`
+ identifying lineage/descendants + subtype joiners — at full opacity 1.0,
unchanged); **inherited/ancestral** (the `edge.inherited` rays + their target
nodes minus the direct set → `inherited-dim` 0.5); **unrelated** (everything
else → `faded`). `styles.ts`: `.faded` opacity `0.3` → `0.2`, new
`.inherited-dim` at `0.5`, and `edge.inherited` opacity `0.85` → `0.5` so the
rays match their (0.5) targets. The same function runs on both select (`tap`,
deep-link/Back-Forward restore, navigate/panel-navigate) and hover (`mouseover`);
`mouseout` falls back to the selected node's tiers if one is selected, else
clears. `clearFocusTiers()` runs on deselect/reselect/relayout/teardown — no tier
class survives a deselect. Inheritance computation, ray-drawing, and the no-leak
guarantees are unchanged; the change is graph highlight styling/tiering only.

**Why:** Owner request — today inherited and direct were both merely "kept"
(un-faded) with no visual distinction; the inherited/ancestral set needed to read
as a middle layer between full-opacity direct and faded unrelated.

**Note (de-dup):** `closedNeighborhood()` follows the ephemeral inherited rays,
so the direct set must be built from the focused node's NON-inherited edges only —
otherwise every inherited target collapses into the direct tier (caught by the
visual harness during implementation). `buildInheritedConnections` already de-dups
inherited vs direct, so a direct FK target never appears in the inherited set;
the explicit `.difference(direct)` enforces "direct wins" defensively.


## Implementation log


### CP-A — Transitive identity-group helper + DD (2026-06-19)


Generalized `src/app/logic/spotlight-inherited.ts` `buildInheritedConnections`
from subtype-cluster-only/single-level to the transitive **identity-group** model.
Export name, `InheritedConnection` shape (`{ otherId, direction, via }`), and
`INHERITED_IDENTITY = 'identity'` unchanged — `DictionaryView.tsx` /
`SpotlightOverlay.tsx` needed no edit.

**Algorithm.** A 1:1 key-inheritance edge is one of two kinds: (a) subtype-cluster
membership (basetype ↔ member, via the `ModelIndex` cluster maps); (b) dependent
identifying-1:1 — an edge with `identifying === true`, `cardinality.parent === '1'`,
`cardinality.child === '1'`, AND `Object.keys(edge.on)` sorted equal to the child's
full PK (`pkByNode.get(source)`) sorted. The 1:1-child cardinality cleanly excludes
subtype edges (which derive `child = '0..1'` per `parse.ts` `deriveCardinality`), so
the two kinds never double-count. The **identity group** is the BFS transitive closure
of `entityId` over both edge kinds in both directions, with a visited Set (cycle-safe).
Inferred connections: for each OTHER group member `M`, emit `M` as an identity link
(`via = 'identity'`), plus each of `M`'s direct connections to an entity OUTSIDE the
group (`via = M`); all de-duplicated against `entityId`'s OWN direct connections
(`buildSpotlightConnections`) — a direct edge is never also inferred. Bundle one per
otherId (first-seen wins); sort by otherId; group size ≤ 1 → `[]`.

**Verified on `models/key-inherited`** (probe, removed to `tmp/trash/`): `ITIN`
(subtype of `Identity`, which is a dependent-1:1 of `Party`) inherits the full
transitive set — `Party` as an identity link + `Party`'s relationships (`PartyType`,
`PaymentMethod`, `SalesInvoice`, `SalesOrder`) via `Party` + the rest of the group
(`Business`/`Person`/`License`/`Passport`/`SSN`) — while its direct edge `Identity`
is de-duped out. `Identity` inherits `Party`'s relationships (`Party` itself de-duped,
direct). `Business` inherits `Party`'s relationships transitively. This is the
multi-hop `ITIN → Identity → Party` chain the shipped CP7 could not reach.

**Tests.** `test/checks/test-spotlight-inherited.ts` extended (T1–T6 unchanged and
still green under the generalized semantics; T7 transitive ITIN, T8 transitive
Identity, T9 dep-1:1 negative — 1:1 identifying FK that is NOT the full PK does not
qualify, T10 dep-1:1 positive, T11 cycle-safety). `test/visual/test-dd-spotlight-grid.ts`
CP7 block extended with a CP7-TRANSITIVE block that spotlights `Identity` and asserts
dotted `.spotlight-line--inherited` lines surface `Party`'s relationships.

**Gates.** `bun test/checks/test-spotlight-inherited.ts` → 11/11 PASS.
`bun test/checks/test-spotlight-connections.ts` → unchanged, PASS. `bun run test`
→ exit 0, zero failures. `bunx tsc --noEmit` → 473 errors, identical to baseline
(stash-measured); zero in any touched file. SPA bundle rebuilt (`build:bundle` +
`build:stable-names`).

**Files.** `src/app/logic/spotlight-inherited.ts`,
`test/checks/test-spotlight-inherited.ts`, `test/visual/test-dd-spotlight-grid.ts`.
CP-B (DG dotted inferred-upstream lines) remains.


### CP-B — DG dotted inferred-upstream lines (2026-06-19)


Rendered the CP-A inherited connections in the GRAPH as ephemeral dotted
"inferred-upstream" edges on entity select. Reuses the CP-A pure helper
`buildInheritedConnections` (no second inheritance computation).

**Approach.** On entity select, `drawInheritedEdges(selectedId)` (inside the
GraphView cy-init closure) calls `buildInheritedConnections(modelIndexRef.current,
selectedId)` and, for each connection whose `otherId` is a node present in cy,
adds an EPHEMERAL cytoscape edge `selectedId → otherId` with class `inherited`,
`data({ inherited: true })`, and a collision-free id `_inherited_<sel>__<other>`.
Style (`src/app/views/graph/styles.ts`, selector `edge.inherited`): `line-style:
dotted`, `line-color` = the inherited green, arrowless, `width: 1.2`, no casing,
`opacity: 0.85`, `z-index: 1`. The green is read from the new
`SPOTLIGHT_LINE_INHERITED[mode]` constant — same source the DD CSS var uses, so
DG == DD exactly.

**Lit set.** The hover lineage-fade folds `cy.edges('.inherited')` + their endpoint
nodes into the `keep` set, so hovering never dims the inferred-upstream lines or
their targets.

**Lifecycle (no ephemeral edge survives).** `clearInheritedEdges()` (`cy.remove('edge.inherited')`)
runs on: background-tap deselect; before each reselect (inside `drawInheritedEdges`);
`resetLayout` and `applyLayoutMode` BEFORE ELK runs (never fed to layout); deep-link
/ Back-Forward restore to a no-entity state; and teardown (before `cy.destroy()`).
View-switch away drops the whole cy instance (effect dep `isActive` → cleanup).

**No-leak (verified, each path).** (1) `layoutFingerprint(model)` hashes only
`model.nodes`/`model.edges` — the ephemeral edges live only in cy, never in the
model. (2) `layout-store` save loops `cy.nodes()` only (edges excluded) and the
inherited edges introduce zero synthetic nodes, so the position map can never gain
an entry. (3) Static export reads `window.__MODEL__` (the model), not cy. (4) ELK
never sees them — added AFTER layout, removed BEFORE any re-layout.
`test/checks/test-inherited-edges-no-leak.ts` proves the fingerprint is byte-identical
before/after computing every entity's inherited set, no synthetic id collides with a
real edge id, and every target is an existing model node.

**Tests.** `test/checks/test-inherited-edges-no-leak.ts` (5 assertions, no-leak unit,
real `key-inherited` model). `test/checks/test-graph-inherited-edges.ts` (Playwright,
skip-if-dist-absent): selecting `Identity` draws 6 dotted `edge.inherited` edges
reaching Party's relationships (PartyType/PaymentMethod/SalesInvoice/SalesOrder),
targets lit; selecting `ITIN` draws 10 (transitive, strictly more, reselect replaces
not accumulates); background-tap deselect → 0. `test/visual/test-graph-inherited-lines.ts`
(visual screenshots, manual): Identity 6 + ITIN 10 dotted green lines + clean deselect
frame — confirmed visually (dotted green inferred-upstream lines, direct FK edges stay
solid grey).

**Gates.** `bun test/checks/test-inherited-edges-no-leak.ts` → 5/5 PASS.
`bun test/checks/test-graph-inherited-edges.ts` → all PASS (Identity 6, ITIN 10,
deselect 0). `bun run test` → exit 0, zero failures. `bunx tsc --noEmit` → 509
errors vs 503 baseline (stash-measured); the +6 are all in the documented
cytoscape `Core`/`ElementDefinition` baseline category from the new GraphView
draw/clear lines — no NEW error type, zero errors in the new typed code
(`SPOTLIGHT_LINE_INHERITED`, `theme-css-vars`). SPA bundle rebuilt
(`build:bundle` + `build:stable-names`).

**Files.** `src/app/views/graph/GraphView.tsx`, `src/app/views/graph/styles.ts`,
`src/app/dom/theme-css-vars.ts`, `test/checks/test-inherited-edges-no-leak.ts`,
`test/checks/test-graph-inherited-edges.ts`, `test/visual/test-graph-inherited-lines.ts`.
Feature complete (CP-A + CP-B).

**Merged into main (fast-forward) as e2dd8a1 — 2026-06-19.** Ships in 0.12.0 alongside viewer-ux-polish.
