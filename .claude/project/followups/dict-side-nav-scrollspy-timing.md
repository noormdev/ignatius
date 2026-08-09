---
id: dict-side-nav-scrollspy-timing
title: 'Side-nav scrollspy test: scrollIntoView → waitForFunction implicit layout assumption'
created: "2026-05-29"
origin: |
    docs/spec/dict-navigation.md, polish iter reviewer
severity: risk
review_by: "2026-10-01"
status: open
file: test/checks/test-dict-side-nav.ts:137
---

test/checks/test-dict-side-nav.ts:137 — scrollIntoView is called inside page.evaluate() before control returns to Node; the subsequent waitForFunction polls for IntersectionObserver to fire. Assumption: browser commits layout before the evaluate resolves. Passes in practice with 3000ms budget; flagged for record.

**2026-08-02 review — severity nit → risk.** The predicted failure mode landed twice
in one session, in two other tests. `test-flow-search.ts` read node opacity straight
after an outer-tree wait, but the flow SVG is a separate React root reached through an
effect, so the value settles one commit later — green locally and on 2 CI runs, then
failed 6 consecutive CI runs. `test-dict-search-branding-overlap.ts` read geometry
250ms after `setViewportSize` and failed 3/3 on a loaded machine. Both fixed by polling
for the settled value instead of assuming a budget. This entry is the same assumption
at `test-dict-side-nav.ts:137` and its 3000ms budget is the only thing holding it up.
