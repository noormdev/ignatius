---
id: dict-side-nav-scrollspy-timing
title: 'Side-nav scrollspy test: scrollIntoView → waitForFunction implicit layout assumption'
created: "2026-05-29"
origin: |
    docs/spec/dict-navigation.md, polish iter reviewer
severity: nit
review_by: "2026-07-28"
status: open
file: test/checks/test-dict-side-nav.ts:137
---

test/checks/test-dict-side-nav.ts:137 — scrollIntoView is called inside page.evaluate() before control returns to Node; the subsequent waitForFunction polls for IntersectionObserver to fire. Assumption: browser commits layout before the evaluate resolves. Passes in practice with 3000ms budget; flagged for record.
