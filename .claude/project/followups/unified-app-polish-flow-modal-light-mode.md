---
id: unified-app-polish-flow-modal-light-mode
title: Flow-view dialogs may render dark in light mode
created: "2026-06-08"
origin: |
    docs/spec/unified-app-polish.md, CP8 reviewer observation
kind: finding
severity: risk
review_by: "2026-08-07"
status: open
file: src/App.tsx
---

During CP8 review, dialogs opened from the **Flows view** (process ⓘ, db: store ⓘ, entity dialog) appear to render with a DARK background even when the app is in LIGHT mode. The theme toggle sets `data-theme` on documentElement, but the modal in the flow context seems to inherit the DFD SVG container colors rather than the light theme.

**Why:** light-mode quality bar (the user cares about DFD light mode — see CP10c/P6). If real, all flow-opened dialogs are dark-on-light in light mode.

**How to apply:** verify with a screenshot of a flow-view dialog in light mode (open Flows, toggle light, open a process/db-store ⓘ). If confirmed, trace where the modal backdrop/surface picks up color in the flow render path vs the graph render path. Pre-existing (not introduced by the unified-app-polish batch); deferred to keep that batch scoped. Reviewer note origin: CP8 reviewer, b0022bd.
