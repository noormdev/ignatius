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


- [ ] A pure `identity-group` helper computes the transitive closure of an entity over 1:1 key-inheritance edges — **subtype-cluster membership** AND **dependent identifying-1:1** (child PK columns == an identifying 1:1 FK's columns). Unit-tested on `ITIN → Identity → Party` (multi-hop) and `Business → Party` (single-hop).
- [ ] Inferred connections for `A` = every other group member + each member's external (out-of-group) direct relationships, with `via` provenance, de-duplicated against `A`'s direct relationships (a direct edge is never also inferred). Unit-tested.
- [ ] DD spotlight uses the generalized helper: spotlighting `Identity` surfaces Party's relationships; spotlighting `ITIN` transitively surfaces Identity's AND Party's relationships + siblings — all dotted. (Replaces CP7's subtype-only behavior; `test-spotlight-inherited.ts` updated.)
- [ ] DG graph: selecting `Identity` draws DOTTED inferred lines (color `--spotlight-line-inherited`) to Party's relationships (+ siblings), with those nodes kept lit; selecting `ITIN` draws them transitively to Identity's + Party's relationships. Direct edges stay solid. A visual screenshot on `models/key-inherited` confirms.
- [ ] The DG ephemeral lines never enter the model, the `layoutFingerprint` / saved positions, or the static export; they are removed on deselect / reselect / view-switch. A check asserts no inherited artifact leaks into `layoutFingerprint` / persistence.
- [ ] No new `tsc --noEmit` errors vs baseline; `bun run test` exits 0; `bun run build:cli` succeeds.


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
