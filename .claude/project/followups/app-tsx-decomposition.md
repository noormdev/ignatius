---
id: app-tsx-decomposition
title: Decompose App.tsx — 5300+ lines hosting all three views
created: "2026-06-10"
origin: |
    user request during render-perf-indexing (CP4)
kind: finding
severity: risk
review_by: "2026-08-09"
status: open
file: src/App.tsx
---

App.tsx is ~5300 lines and hosts all three views (Graph/Cytoscape, Dictionary, Flows/SVG) plus every modal, the FAB, zoom controls, hash router glue, the cy-init effect, and now the ModelIndex wiring. It is WAY too big to reason about or review safely — the render-perf-indexing CP4 diff alone touched dozens of call sites across one file.

Decompose it: extract the three views into their own modules (GraphView, DictionaryView, FlowsView), pull shared modal primitives, the cy-init effect, and the hash-router glue into separate files, and lift pure helpers (parseDottedNumber, compareDottedProcesses, resolveBodyClick, buildAllFlowNodeIds, etc.) out. Each extraction should be behavior-neutral and screenshot-verified.

This is its own dedicated refactor PR (large blast radius) — NOT to be folded into a feature batch. Plan via /atomic-plan when prioritized.

**Why:** a 5300-line component is a reliability and review hazard; every change risks unrelated breakage and diffs are hard to gate.
**How to apply:** dedicated branch, /atomic-plan a decomposition spec, extract one cohesive view/module per checkpoint, screenshot-verify each.
