# Help overlay (orientation modal)

## Problem

A first-time viewer who opens an exported model has no idea what they are looking
at. The Graph shows colored boxes and lines with no key; the Dictionary has two
unexplained lenses; the Flows view uses DFD notation few people know. The existing
`LegendModal` answers "what does this *symbol* mean" but not "what *is* this, and
how do I use it". There is no orientation surface and nothing tying the keyboard
shortcuts, the Shift-lineage gesture, or the key-inherited/surrogate distinction
together for a newcomer.

## Goals / Non-goals

- Goals: a one-keystroke (`?`) and one-click (top-bar button) orientation overlay
  that explains the *current* view in brief — what it is, how to explore it, the
  key concepts, and the keys that work here.
- Goals: view-aware content (Graph / Dictionary / Flows each get their own body).
- Goals: terse. One line per concept, no walls of text. The user's explicit ask.
- Non-goals: replace the `LegendModal` (symbol reference stays separate; the help
  overlay points to it).
- Non-goals: a guided tour, tooltips, or first-run auto-open. Just an on-demand
  overlay.
- Non-goals: configurable content or per-model help text.

## Approach

A new `HelpModal` component built on the shared `Modal` primitive, switched on the
active `ViewName`. Content is a small set of static term→description rows per view,
authored in the component (not data-driven — it describes the app itself, which
the app already knows). Trigger paths:

- A `?` top-bar button placed just left of the theme toggle (same pill treatment).
- The `?` key, added to the existing pure shortcut resolver (`shortcuts.ts`) as a
  `help` action. `?` is Shift+`/`, so it is resolved *after* the editable guard
  but *before* the bare-key modifier guard (which would otherwise swallow the
  Shift). Gated off ctrl/meta/alt. Suppressed while typing.

Why a separate component, not an extension of `LegendModal`: the two answer
different questions (orientation vs. symbol key) and a newcomer benefits from
both. Folding them would make one long modal and blur the purpose. The help
overlay *links* to the Legend for symbol detail.

Why static content in the component: the explanations are about ignatius itself
(entity classifications, lenses, DFD notation, the Shift gesture) — invariant
across models. Data-driving it would add machinery for no gain.

## Content shape (per view)

| View | Sections |
|------|----------|
| Graph | What you're looking at · Entity types (Independent/Dependent/Subtype/Associative/Classifier) · How to explore (layouts, Shift+hover lineage, click/drag/zoom) · Two modeling styles (key-inherited vs surrogate) · Keyboard |
| Dictionary | What you're looking at (Read/Browse lenses) · How to explore (spotlight, Shift+hover lineage, search/focus) · Keyboard |
| Flows | What you're looking at (DFD) · Symbols (process/store/external) · How to explore (drill-down, inspect) · Keyboard |

The Keyboard section is tailored per view (only the keys active there). Graph and
Flows footnote a pointer to the Legend for exact symbols.

## Open questions

- None blocking. A future first-run auto-open (dismissible, remembered in
  localStorage) is a possible follow-up but deliberately out of scope here.
