# Viewer UX polish


## Problem


Real-use feedback from the model owner. Seven irritations; #7 (graph search
highlight) is filed as issue #18 and deferred. Six are fixed here (#1–#6, #8):

- #1 — The HTML `<title>` is hardcoded `Ignatius`, so model tabs and bookmarks are indistinguishable.
- #2 — The DD browse-lens spotlight collapses every edge between two cards into ONE bezier line; a bidirectional (`both`) or dual-FK relationship draws arrowheads at both ends of the same path, so lines and arrows overlap and a relationship is lost (Image #1).
- #3 — Zoom `100%` is measured against the fit-to-screen baseline, so it means a different physical size per model; large diagrams read tiny at 100% and need 400%.
- #4 — Trackpad pinch and Cmd `+`/`-` zoom the browser page, not the canvas, so the viewer controls scroll out of view.
- #5 — The DFD process node is a fixed 120×68 rect; long process names overflow it (Image #6).
- #6 / #8 — Closing an entity modal never clears `entity=` from the URL, and opening one never pushes history, so browser Back can't step back through visited entities.


## Goals / Non-goals


Goals:

- Each item fixed with the smallest change that holds, matching existing conventions.
- Consistent behavior across DG (Cytoscape) and DFD (custom SVG) for the items that span both (#3, #4).

Non-goals:

- Graph search-highlight (#18) — deferred; the owner will elaborate later.
- Redesigning the spotlight connection model or the DFD layout engine.
- An elkjs bump (already 0.11.1) or new theme tokens beyond what a fix needs.


## Decisions


### #3 zoom — 100% = native 1:1, Home = fit


`100%` means one diagram unit renders as one CSS pixel (Cytoscape `zoom===1`;
SVG transform `scale===1`), independent of model size. The initial view still
fits-to-screen, but the readout shows the true percentage (e.g. 42% on a large
model, 180% on a small one). The Home/reset button still fits-to-screen
(unchanged action); it no longer forces the readout to `100%`.

Rejected: keep fit-as-100% (the reported behavior) and renormalize only the
label — that preserves the size inconsistency the owner hit.


### #2 spotlight — always separate


Overlapping/bidirectional connections are fanned apart at all times (the owner's
chosen option), so a relationship is never hidden regardless of selection. Two
mechanisms:

- Split a `both` bundle (and any multi-edge bundle) into one drawn line per direction/edge.
- Offset each line's connection point along the facing card edge so parallel lines and their arrowheads don't coincide.

Rejected: fan out only on hover/selection — still hides relationships at rest.


### #4 input routing


Pinch arrives as `ctrl`+wheel; Cmd `+`/`-`/`0` are keyboard. Intercept both over
the canvas, `preventDefault` the browser page-zoom, and route to the active
view's zoom. The keyboard resolver currently returns null on any modifier
(`shortcuts.ts:63`); extend it with a modifier-gated zoom action rather than
loosening the existing bare-key guard.


### #1 title source


`document.title` = model display name when present, else `Ignatius`. Precedence:
`ignatius.yml` top-level `name` (already on `_meta`) → fallback constant. Set at
three points: static-export HTML, dev-server HTML, and SPA runtime (so the live
tab updates on model-change).


### #5 DFD process sizing


Measure the wrapped label and size the process rect to it, with a min-size floor
that preserves the current look for short names; feed the measured size to ELK
`nodeSize` so band spacing stays correct. Externals/stores already text-measure
via `estW` — reuse that path.


### #6/#8 modal history


Treat an open entity modal as a history entry. `openEntityById` pushes
(`pushState`) `entity=<id>`; closing the modal calls `history.back()` when the
top entry is a modal we pushed, else clears `entity=` via `replaceState`;
`popstate` opens/closes the modal to match the hash. Reconcile with GraphView's
existing `entity=` hash-write so the two don't double-write.


### #9 inherited 1:1 key-inheritance connections (CP7)


In the DD spotlight, a subtype member shares its basetype's primary key (1:1 key
inheritance — the child IS the parent), so it transitively participates in the
basetype's relationships and relates to its sibling subtypes. Today the spotlight
walks only the active entity's DIRECT FK edges, so a subtype looks unrelated to
its parent's other relationships and to its siblings — misleading, since the
shared key makes the relationship inferable.

Decision: surface INHERITED connections in the spotlight, derived from
subtype-cluster identity (the model's `subtypeClusters` are the canonical 1:1
key-inheritance primitive):

- Active = subtype member → inherit the basetype's direct connections + the sibling members (the basetype's other subtypes).
- Active = basetype → inherit each member's direct connections.
- De-duplicate against the active's own direct connections; never duplicate a direct edge.

Render inherited connections visually distinct from direct FK lines (a separate
dotted style + "via &lt;basetype&gt;" label) so direct vs. inferred is
unambiguous, and apply the CP6 line-separation so they don't overlap.

Scope: subtype clusters are the v1 signal (the clearest, well-modeled 1:1
key-inheritance case, and the owner's example — Business/Individual as subtypes of
Party). General identifying-1:1 dependent extension tables (a child whose full PK
is inherited via an identifying 1:1 edge) are a natural extension, noted but not
required for CP7. Rejected: inferring through any FK — only shared-identity (1:1
key inheritance) qualifies, else the spotlight would over-connect.


## Open questions


None blocking.
