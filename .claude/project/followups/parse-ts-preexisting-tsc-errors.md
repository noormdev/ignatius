---
id: parse-ts-preexisting-tsc-errors
title: Fix 6 pre-existing tsc errors in src/parse.ts
created: "2026-05-30"
origin: |
    derive-classification build, iter 1 reviewer + final verify
severity: nit
review_by: "2026-10-01"
status: open
file: src/model/parse.ts
---

6 pre-existing `bunx tsc --noEmit` errors in src/parse.ts, predating the derive-classification work (commits 50b6897 + 20c7dd5). CI runs typecheck with continue-on-error so they are non-blocking today. Fix if typecheck is ever promoted to a hard gate.

**2026-08-02 review — scope is far larger than 6.** `bunx tsc --noEmit` now reports 646
errors on a clean worktree (1892 in the main checkout, whose node_modules is in a mixed
pnpm/bun state). The bulk are cytoscape typings in `src/app/views/graph/GraphView.tsx`
(126 alone: `Property 'x' does not exist on type 'Core'`, `Namespace '"cytoscape"' has no
exported member ...`) — see [[dfd-polish-round3-cytoscape-typing]], which owns that
cluster. `src/parse.ts` has also moved to `src/model/parse.ts` (path corrected above).
Promoting typecheck to a hard gate is a much bigger job than this entry implies.
