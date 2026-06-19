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


<!-- empty on creation -->


## Implementation log


<!-- appended per checkpoint -->
