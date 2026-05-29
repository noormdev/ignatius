---
id: dict-side-nav
title: 'Dict: toggleable side nav with scrollspy + entity jump links'
created: "2026-05-29"
origin: |
    user request, session 2026-05-29
severity: risk
review_by: "2026-07-28"
status: open
---

When viewing the dict (either generated HTML or the eventual interactive dict-in-server mode), add a side nav listing all entities grouped by their group, with the current entity highlighted as the user scrolls. Click-to-jump to entity anchor.

Placement: upper-right corner, toggleable via a button next to the theme toggle. Same pattern as the dark/light switcher.

Consider: scrollspy implementation in vanilla JS for the static dict; React component for the interactive viewer.
