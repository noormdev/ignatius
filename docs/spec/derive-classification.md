# Derive classification + identifying from keys — spec


## Goal

Make keys the single source of truth for entity classification and relationship identifying-ness. The parser derives both from PK+FK structure instead of trusting hand-authored frontmatter. The only surviving hand-authored signal is `reference: true` for classifier/lookup tables (classifier-ness is semantic, not a key shape).


## Background

In IDEF1X an identifying relationship ≡ the FK columns are part of the child PK ≡ the child is dependent. One fact, three names — and it lives in the keys. Previously `classification` and per-relationship `identifying` were hand-authored and copied through `parseModels` with zero validation; only `classification === 'Subtype'` changed the diagram, the rest were cosmetic. A file could declare `Independent` while its keys said dependent and nothing complained.


## Contract — derivation rules

**`identifying` (per relationship):** `true` iff every child FK column in `edge.on` is a member of the child entity's `pk`. Else `false`.

**`classification` (per node), first match wins:**

| # | Rule | Condition |
|---|------|-----------|
| 1 | **Classifier** | `frontmatter.reference === true` OR legacy `classification: Classifier` |
| 2 | **Subtype** | entity id is a member of some basetype's `subtypes[].members` |
| 3 | **Associative** | ≥2 distinct identifying parents (FK-in-PK from 2+ parents) |
| 4 | **Dependent** | ≥1 identifying relationship (FK-in-PK), single parent |
| 5 | **Independent** | none of the above (no FK in PK) |

Subtype precedes associative/dependent (a subtype member has an identifying `is a` rel but must classify as Subtype). Classifier detection runs first so lookup tables with natural `code` PKs (which structurally look Independent) resolve correctly.

Derivation is two-pass: collect raw nodes/edges + subtype clusters, THEN derive identifying → membership set → identifying-parent counts → classification. Downstream readers (`App.tsx`, `markers.ts`, `dict.ts`) consume the derived `node.classification` / `edge.identifying` unchanged.


## Authoring impact

A model entity no longer states `classification` or per-relationship `identifying`. The keys say it. Classifier tables add `reference: true`. Both legacy fields are still accepted by the parser (ignored / used as fallback) for backward compatibility, but the canonical `models/` no longer carries them.


## Success criteria

- [x] `identifying` derived as FK ⊆ child PK.
- [x] `classification` derived per the 5-rule order.
- [x] `reference: true` is the sole hand-authored classifier signal.
- [x] All `models/` entities carry zero `classification:`/`identifying:` lines.
- [x] Derivation over `models/` yields Classifier 3 / Subtype 10 / Dependent 7 / Associative 1 / Independent 3; cardinality 10×(1:0..1), 1×(1:1), 16×(1:many) — unchanged from pre-change.
- [x] `test/checks/test-derive-classification.ts` asserts the explicit expected truth per entity.


## Implementation log


### shipped — 2026-05-30

Built across 2 iterations of /subagent-implementation (inline brief, no prior spec — design settled in conversation). Commits (chronological):

- `50b6897` — CP-1 parser derives `identifying` + `classification`; new test (45 assertions); `classification`/`reference` frontmatter made optional.
- `20c7dd5` — CP-2 strip `classification:`/`identifying:` from all 24 entities; `reference: true` on 3 classifiers; F-1 test-nit fix.

**Out-of-scope work performed during this build:**
- CP-2 rebuilt the local `dist/ignatius` binary — the pre-CP-1 compiled parser crashed (`classification.toLowerCase`) once the source files lost their `classification:` field. `dist/` is gitignored, so not committed.

**Unforeseens:**
- The compiled binary embeds a parser snapshot; stripping the fields broke the old binary until rebuilt. Confirms the binary must be rebuilt whenever parser-visible model shape changes.

**Deferred items still open (disposition at finalize):**
- `docs/spec/ignatius-modeling-skill.md`, `docs/spec/schema-lint-and-error-ux.md`, and followup `ignatius-authoring-skill` reference a hand-authored `classification` that no longer exists — reconcile needed.
- 6 pre-existing `tsc --noEmit` errors in `src/parse.ts` (predate this work).


## Change log


<!-- First amendment after approval goes here. -->
