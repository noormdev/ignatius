---
id: branding-overlap-fix
title: 'Branding header: stop overlapping content, add translucent backdrop'
created: "2026-05-29"
origin: |
    user request, session 2026-05-29
severity: risk
review_by: "2026-07-28"
status: open
file: src/generators/dict.ts
---

Branding block (top-left fixed div with logo + title + subtitle) currently overlaps the first entity heading on the static dict. Two fixes:

1. Reserve vertical space so main content starts below the branding block (push `.page-header` / first `.entity-section` down by the branding height + a margin).
2. Add a translucent blurred backdrop behind the branding so any content that scrolls under it remains legible — `backdrop-filter: blur(8px); background: rgba(var(--color-background-rgb), 0.6);` or similar.

File: src/generators/dict.ts CSS block, .dict-branding rule. Also applies to interactive viewer src/styles.css.

Note: CP-2 mobile already relocates branding to top-right on narrow viewports — verify that path still works after fix.
