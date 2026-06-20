# Key-inheritance lineage


## Problem


A key-inherited entity shares its primary-key ancestry with a whole family of
entities — they all carry the same key columns by inheritance, so selecting one
should surface the family. The lineage spotlight (DD dotted lines + DG dotted
inferred-upstream rays) exists to reveal that shared-key family.

The first implementation got the rule wrong in two directions (owner-reported,
verified against `models/key-inherited`):

1. **Over-connected through SECONDARY (non-key) FKs.** It surfaced each lineage
   member's *external direct FK* connections — including non-key FKs. Selecting
   `SI Line` drew lines to `Product` / `Subscription` (from a subtype's secondary
   `→ Product` FK); selecting `SIL Subscription` drew to `LineItemType` via `SI
   Line`'s secondary classifier FK. None of those share a primary key; they are
   wrong.
2. **Missed identifying 1:many key inheritance.** Detection required FK == the
   child's FULL PK at cardinality 1:1, so it never reached entities whose
   inherited key is a PROPER SUBSET of their PK. Selecting `SSN` should reach
   `SalesInvoice` / `SI Line` / `SalesOrder` / `SO Line` / `Payment Allocation`
   (all carry `party_no` inside a larger PK — the chain `SSN → Identity → Party
   ← SalesInvoice ← SI Line`), but the FK-==-full-PK + 1:1 gate excluded every
   `party_no ⊂ PK` (cardinality 1:many) hop.


## The rule: lineage = the key-edge connected component


Lineage follows ONLY **key-inheritance edges** — never a secondary (non-key) FK.

- **Key edge** (a.k.a. identifying / PK-FK edge): an edge whose child-side FK
  columns (the keys of `edge.on`) are ALL contained in the child (source) node's
  primary key. This is a SUBSET test (FK ⊆ child PK), NOT equality:
  - Subtype member → basetype (FK == full PK) → ⊆ ✓ key edge.
  - `SalesInvoice → Party` (`party_no ⊂ {party_no, invoice_no}`) → ⊆ ✓ key edge
    — the identifying 1:many case (FK is a PROPER SUBSET of the PK).
  - `SIL Product → Product`, `SI Line → LineItemType`, `Party → PartyType`
    (classifier / catalog secondary FKs) → ⊄ ✗ NOT key edges.

  On `models/key-inherited` the parser's derived `edge.identifying` flag is
  exactly equivalent to FK ⊆ PK on every edge (verified empirically). The
  implementation uses the FK ⊆ PK subset test as the DEFINITION — it is the
  precise IDEF1X identifying semantics and is robust if the parser's derivation
  ever drifts.

- **Lineage of an entity** = the transitive CONNECTED COMPONENT of that entity in
  the graph of KEY EDGES ONLY, traversed in BOTH directions (key edges treated as
  undirected — two entities share lineage if connected by ANY chain of key edges).
  This is the set of entities that share a primary-key ancestry. Subtype clusters
  fall out for free: every subtype member→basetype relationship IS a key edge, so
  the key-edge component already captures subtype membership — no separate cluster
  walk is needed.

**Inherited (inferred) connections** of `A` = the lineage members, EXCLUDING:

- `A` itself, AND
- `A`'s DIRECT real-edge neighbours — entities already connected to `A` by any
  real graph edge render as SOLID lines; we never also draw a dotted lineage line
  to them.

Bundled one per `otherId`; sorted ascending by `otherId`. An entity in a trivial
(singleton) lineage, or whose lineage adds nothing beyond its direct neighbours,
returns `[]`. `direction` is always `'both'` (a shared-key kinship has no inherent
direction); `via` is the nearest key-edge predecessor on the path (so the DD pill
can read "via &lt;nearest kin&gt;"), or `INHERITED_IDENTITY` when no nearer kin
exists. Consumers mainly use `otherId`.


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


- Inferring through SECONDARY (non-key) FKs — only key edges (FK ⊆ child PK) qualify, in either direction and at any cardinality (1:1 or 1:many). A secondary FK is never followed (else the graph over-connects to catalogs/classifiers).
- Changing the underlying model, edges, or classification.
- A separate hover (vs select) trigger in the DG beyond what the existing highlight already does — match the existing graph interaction.


## Open questions


None blocking.


## Change log


- 2026-06-19 — **Corrected the lineage rule.** Replaced the "identity group =
  subtype-cluster membership + dependent identifying-1:1 (FK == full PK + 1:1),
  then per-member external direct-FK expansion" model with: lineage = the
  transitive connected component over KEY EDGES (FK ⊆ child PK, a SUBSET test),
  both directions; inherited = lineage − self − direct-real-edge neighbours; no
  secondary FK is ever traversed or surfaced. **Superseded:** the prior model
  over-connected through secondary FKs (e.g. `SI Line → Product` /
  `→ LineItemType`) and missed identifying 1:many key inheritance (FK a proper
  subset of the PK, e.g. `SalesInvoice → Party`), so it could not reach the
  `SSN → Identity → Party ← SalesInvoice ← SI Line` family. The FK ⊆ PK subset
  test is the precise IDEF1X identifying semantics and (empirically) matches the
  parser's `edge.identifying` flag exactly on `models/key-inherited`.
