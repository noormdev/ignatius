---
id: parse-ts-preexisting-tsc-errors
title: Fix 6 pre-existing tsc errors in src/parse.ts
created: "2026-05-30"
origin: |
    derive-classification build, iter 1 reviewer + final verify
severity: nit
review_by: "2026-07-29"
status: open
file: src/parse.ts
---

6 pre-existing `bunx tsc --noEmit` errors in src/parse.ts, predating the derive-classification work (commits 50b6897 + 20c7dd5). CI runs typecheck with continue-on-error so they are non-blocking today. Fix if typecheck is ever promoted to a hard gate.
