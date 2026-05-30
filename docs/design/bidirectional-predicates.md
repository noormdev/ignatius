# Bidirectional edge predicates


## Problem


Each relationship carries a single `predicate` string, authored on the child (FK-holding) entity and phrased from the child's perspective — e.g. `Party → PartyType` reads "is classified by". The graph, however, draws edges parent→child (ELK `DOWN`), so the visible label reads *backwards* relative to the line's visual flow. For `Party → SalesInvoice` the edge reads "is owed by Party" when the natural top-down reading wants "Party owes SalesInvoice".


A relationship has two legible readings, and only one is authored:

- **Forward** (parent→child): "Party *owes* SalesInvoice".
- **Reverse** (child→parent): "SalesInvoice *is owed by* Party".


The current model can express only one, so one direction is always wrong.


## Goal


Author both readings per relationship; render forward by default (matching the parent→child visual flow); flip to reverse on hover so both directions are legible without permanent clutter.


## Prior art


The original (pre-markdown-pivot) grammar already modeled this. `spec/spec.md §2.7` and the surviving fixture `test/fixtures/sample_model.yaml` both use:

    predicate: { fwd: "parent verb", rev: "child verb" }

`fwd` reads parent→child, `rev` reads child→parent, neither derived from the other. This design re-adopts that shape for the markdown frontmatter and the in-memory model.


## Decisions


| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Frontmatter accepts `predicate: { fwd, rev }` **or** a plain string. A string maps to both directions (`fwd = rev = string`). | Re-adopts the original grammar; keeps existing string-form models parsing without edits. |
| D2 | `fwd` reads parent→child (default label). `rev` reads child→parent. | Matches the parent→child visual flow of the layout. |
| D3 | Hover any node → its incident edges read **from that node's perspective**: edges where it is the child flip to `rev`, edges where it is the parent stay `fwd`. | Generalizes the follow-up's "hover child → inverse"; one rule covers both endpoints coherently. |
| D4 | Author real `fwd`/`rev` pairs in `models/key-inherited/` only (dev default + visual-harness target), lifting wording from `sample_model.yaml`. Other models ride the string→both fallback. | Keeps the slice cohesive and demonstrable; a 59-file sweep across all four models is deferred. |
| D5 | Data dictionary + the entity modal's relationships table show `fwd` as primary, `rev` muted/secondary. | Both readings stay discoverable in the static surfaces, which have no hover affordance. |


## Hover model (D3) worked through


Hovering node `N`:

- Edge where `N` is the **child** (model `source`): default shows `fwd` ("Parent owes N"); on hover show `rev` ("N is owed by Parent") — reads from N's side.
- Edge where `N` is the **parent** (model `target`): `fwd` already reads from N's side ("N owes Child") — keep `fwd`.


So a single mouseover makes every line touching the hovered entity read outward from it. Mouseout restores all labels to `fwd`.


In Cytoscape the edge is built flipped (`source = model.target` = parent, `target = model.source` = child). So "edge where N is the child" is `edge.target() === N`.


## Non-goals


- Migrating `orm-hybrid`, `orm-pure`, `broken-demo` to authored `fwd`/`rev` (separate follow-up; they render the string fallback meanwhile).
- Deriving one predicate from the other (D1: independently authored).
- Arrowheads / crow's-foot changes — markers are untouched.
