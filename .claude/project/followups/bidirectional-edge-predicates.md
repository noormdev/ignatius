---
id: bidirectional-edge-predicates
title: Forward/reverse predicates flowing parent→child, swap on hover
created: "2026-05-30"
origin: |
    user request 2026-05-30
severity: question
review_by: "2026-07-29"
status: open
file: src/parse.ts:56, src/App.tsx:213
---

Predicates should read parent→child by default, with an inverse predicate for the child→parent direction.

**Current:** edges carry a single `predicate` string, rendered one-directionally. For `Party → SalesInvoice` the line reads "SalesInvoice is owed by Party" (child-perspective phrasing).

**Wanted:** the default flow should be parent→child — "Party owes SalesInvoice". That requires a second, inverse predicate per relationship (forward + reverse), as the original spec (`spec/spec.md`) modeled.

**Interaction idea:** edge label normally shows the forward (parent→child) predicate. On hovering a *child* entity, flip the visible edge text to the inverse (child→parent) predicate so both directions are legible.

**Touches:**
- `src/parse.ts` — `ModelEdge` gains an inverse/reverse predicate field; populate from frontmatter (or derive).
- `src/App.tsx:213` — Cytoscape edge `label` mapping; add hover-driven label swap keyed on the moused-over node.
- entity markdown frontmatter — author both predicates (see `relationships[].predicate` in `test/notes/another-idea.md`).

Relates to Open Question #1 (edge-label rendering) in `test/notes/another-idea.md`.
