# DFD arbitrary nesting depth

## Problem

DFD dotted process numbers lose their ancestor prefix beyond ~2 levels of
nesting: a process that should read `5.4.1` renders as `4.1` (user-observed). And
the authoring skill demonstrates only one level of decomposition, so authored
models under-use the renderer's already-recursive sub-DFD support. Implements
issue #15 ("support arbitrary DFD nesting depth").

## Root cause (grounded)

| Where | What |
|-------|------|
| `src/flows/flow-parse.ts:561-562` | Parser composes the FULL relative dotted number from folder nesting: `[...parentDottedNumbers, localNumber].join('.')` → `1`, `1.1`, `1.1.1`. **Correct.** |
| `src/flows/flow-derive-levels.ts:112-124` | `renumberLeaf(leaf, parentN)` renumbers a top-level diagram's DIRECT processes only, to `parentN.<localNum>`. |
| `flow-derive-levels.ts:117` | `localNum` is taken from `parts[parts.length - 1]` — the **last** segment only. |
| `flow-derive-levels.ts:123` | Returns the leaf with `subDfds` **unchanged** — no recursion. |

So a process nested 2+ levels under a top-level diagram keeps its leaf-relative
number (e.g. `4.1`) and never receives the `N.` prefix → renders `4.1` instead of
`5.4.1`. (Even if it were reached, taking only the last segment would collapse
`5.4.1` → `5.1`.) The defect is entirely in `deriveLevels`; the parser is correct.

A second, separate gap: `skills/noorm-modeling/references/dfd-authoring.md` Step F8
+ the folder-layout sketch show a single sub-DFD level and never state that a
child process can itself be decomposed — the skill's implicit one-level cap.

## Goals / Non-goals

- **Goals**
  - Dotted process numbers preserve the full ancestor chain at any depth: `N.a`,
    `N.a.b`, `N.a.b.c`, …
  - The `noorm-modeling` skill's `flow` mode authors/organizes nested DFDs down
    arbitrarily many layers (F8 is explicitly recursive).
- **Non-goals**
  - Parser changes — recursion and relative numbering are already correct.
  - Auto-deriving decomposition levels from a flat diagram set (issue out-of-scope).
  - Changing the L1 overview's "one process per top-level diagram" shape — that is
    a separate structural question, not the numbering defect the user reported.
  - `compareDottedProcesses` / DD-sidebar / renderer changes — already
    depth-agnostic (segment-by-segment; `split('.').length`).

## Approach

Make `renumberLeaf` recurse the whole leaf subtree and prefix `parentN.` to each
process's **full** relative dotted number (not just its last segment):

- direct child `4` → `N.4`
- sub `4.1` → `N.4.1`
- sub-sub `4.1.2` → `N.4.1.2`

A single prefix suffices because the parser's relative dotted number already
encodes full depth from the leaf root. Recurse into `subDfds` so descendants at
every depth receive the prefix. Keep the folder-order fallback for processes
whose number is non-numeric.

Skill: rewrite F8 so decomposition is explicitly recursive (a child process may
itself be a sub-DFD parent, down as many layers as warranted) and extend the
folder-layout sketch to show a second nesting level.

## Verification

- Unit/integration test: parse a fixture with ≥3 (ideally 4) nesting levels via
  `parseFlows` (which runs `deriveLevels`) and assert a depth-3 process =
  `N.a.b` and a depth-4 process = `N.a.b.c` — full chain, no dropped segment.
- No regression: existing `test-leveling.ts`, `test-flow-leveling.ts`,
  `test-parse-flows.ts` still pass (1–2 level numbers unchanged).
- Screenshot: serve the deep fixture/model and confirm the rendered node labels +
  DD sidebar show the full-depth numbers (the user reported it visually).

## Open questions

- None blocking. The deep fixture doubles as the demonstrable "arbitrary depth"
  example the skill change points authors toward.
