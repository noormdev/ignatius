# Key-inheritance lineage


## Problem


Viewer item #9 shipped (CP7 of viewer-ux-polish) as a subtype-cluster-only,
single-level, DD-spotlight-only feature. The owner's real intent is broader
(verified against their model: `Identity` is a DEPENDENT entity with `party_id`
PK = FK→Party at 1:1 — a *dependent* key inheritance, not a subtype — and
`ITIN → Identity → Party` is a multi-hop 1:1 chain):

- Inheritance must be **transitive** up every 1:1 key-inheritance hop: `ITIN` inherits `Identity`'s relationships AND `Party`'s; `Business` inherits `Party`'s.
- It must cover **dependent identifying-1:1** key inheritance (`Identity`), not only subtype clusters.
- It must appear in the **graph (DG)** as dotted inferred-upstream lines — the same concept as the DD spotlight — not only in the DD.


## The model: identity group


Two entities share identity when connected by a **1:1 key-inheritance edge**:

- **Subtype membership** — `subtypeClusters` basetype ↔ member (1:1 key-inherited by definition).
- **Dependent identifying-1:1** — child `C` has an identifying FK to parent `P`, cardinality 1:1, and `C`'s PK columns ARE the FK columns (the child's key is inherited wholesale from the parent). `Identity` (PK `party_id` = FK→Party, 1:1) qualifies.

The **identity group** of an entity `A` is the transitive closure over those edges
(both directions). Every member shares `A`'s identity — the same key value,
transitively.

**Inferred (inherited) connections** of `A` = for every OTHER member `M` of `A`'s
identity group:

- `M` itself (related to `A` via the shared key), unless `M` is already a direct relationship of `A`.
- `M`'s direct relationships to entities OUTSIDE the group (provenance "via `M`"), unless already a direct relationship of `A`.

De-duplicated against `A`'s own direct relationships — a direct edge never also
draws as inferred (the #9 criterion, retained from CP7).


## Surfaces


- **DD spotlight** — replace CP7's subtype-only `buildInheritedConnections` with the generalized identity-group computation; render unchanged (dotted `--spotlight-line-inherited`).
- **DG graph** — on entity select, draw DOTTED inferred-upstream lines (color `--spotlight-line-inherited`) from the active node to each inferred connection, and keep those nodes lit (not faded). View-only ephemeral overlay: it must NOT enter the model, the layout fingerprint / position persistence, or the static export. Removed on deselect / reselect / view-switch.


## Approach (DG dotted lines)


Preferred: ephemeral Cytoscape edges added on select with a dotted `inherited`
class (`line-style: dotted`, `line-color: var(--spotlight-line-inherited)`, no
crow's-foot), removed on deselect. They follow pan/zoom/drag natively. They are
added AFTER layout (never fed to ELK), carry a class so the lineage-fade keeps
them + their endpoints lit, and are stripped before any `layoutFingerprint` /
position save and excluded from export. Alternative (if ephemeral edges prove to
pollute lifecycle): a position:fixed SVG overlay synced to cy pan/zoom, mirroring
the DD `SpotlightOverlay`. Implementer picks; verify no model/persistence/export
leakage either way.


## Non-goals


- Inferring through non-1:1 or non-identifying FKs — only shared-identity 1:1 key inheritance qualifies (else the graph over-connects).
- Changing the underlying model, edges, or classification.
- A separate hover (vs select) trigger in the DG beyond what the existing highlight already does — match the existing graph interaction.


## Open questions


None blocking.
