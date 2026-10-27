---
id: viewer-qol-f-1
title: Bundle may ship React dev build / StrictMode double effects
created: "2026-10-27"
origin: |
    docs/spec/viewer-qol.md, iter 10 implementer probe
kind: finding
severity: risk
review_by: "2026-12-26"
status: open
file: src/app/main.tsx:1
---

dist/static/index.js may ship React dev-only code: effects disconnect and reconnect about 20 ms after load (StrictMode double-run suspected) in both dev serve and the static export. Observed by the CP5 implementer while probing scroll restore; not proven. Check whether build:bundle's --define of process.env.NODE_ENV reaches the HTML-import build and whether <StrictMode> in main.tsx should be dev-only.
