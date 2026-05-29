---
id: viewer-mode-toggle
title: 'Server viewer: in-app toggle between dict and graph modes'
created: "2026-05-29"
origin: |
    user request, session 2026-05-29
severity: risk
review_by: "2026-07-28"
status: open
---

Add a mode toggle in the interactive server viewer so users can switch between graph and dict views without restarting the CLI. Currently the CLI subcommand picks the mode at startup. Make the running server serve both, with a UI toggle (likely the FAB or a header control).

Related to: hash-router pinning (follow-up viewer-mode-hash-router), FAB consolidation.
