---
id: render-perf-elk-web-worker
title: ELK web worker — needs separate worker build entrypoint to activate under Bun
created: "2026-06-10"
origin: |
    docs/spec/render-perf-indexing.md, CP6 (bundler-blocked)
kind: finding
severity: risk
review_by: "2026-08-09"
status: open
file: src/App.tsx
---

ELK runs on the main thread; for large models the first-load layout (now ~10s after L2) blocks the tab. Moving ELK to a Web Worker would keep it non-blocking (+ allow a progress spinner). The CP6 attempt built the architecture (worker body, ELK-graph builder with headless node-dimension estimation, integration with a proven graceful fallback) but it NEVER ACTIVATES under Bun's HTML bundler: `new Worker(new URL('./elk-layout-worker.ts', import.meta.url))` gets inlined into the single chunk, so it always falls back to main-thread ELK. Not committed (speculative dead code; also bloats App.tsx which is slated for decomposition). Scaffolding preserved at tmp/trash/cp6-worker/ for reference.

**What's actually needed:** build the worker as a SEPARATE bun build entrypoint (its own chunk), serve it at a known URL in dev/bundle mode, and INLINE its source as a Blob URL for the single-file `export -o model.html`. Then wire it into the cache-MISS branch only (L1 preset-skip still wins on warm cache; L2 options still apply; CP5b forceRender after). Graceful fallback to main-thread ELK on any worker failure is mandatory.

**Why deferred:** L2 already makes the 361-entity model RENDER (was crashing); the worker is a non-blocking nicety, not a blocker. It needs a focused build-infra session, not a feature-batch slot.

**How to apply:** dedicated branch; add worker entrypoint to build:bundle + scripts/stable-names; serve route + static inline; reuse buildElkGraph/estimateNodeDimensions from tmp/trash/cp6-worker/.
