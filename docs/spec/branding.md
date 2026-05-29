# Branding system — spec


## Goal

Render configurable logo + title + subtitle in the upper-left and a fixed footer with copyright (and by default a "powered by Noorm" link) on every ignatius output surface — interactive viewer, dict HTML, graph HTML. Configuration lives in `models/_branding.yaml`. Defaults to Noorm branding when the file is absent, and the default case is fully offline-capable.


## Non-goals

- Per-page or per-entity branding overrides
- Theme-specific logo auto-tinting (user supplies separate variants if needed)
- Custom CSS / arbitrary HTML injection
- Branding for node fills, edges, or group colors — that belongs in `_theme.yaml`
- A logo upload UI


## Success criteria

- [ ] `models/_branding.yaml` is optional; absence yields Noorm defaults on all three surfaces with no network access
- [ ] Noorm logo SVG is committed to the repo and imported with `with { type: "file" }`; the compiled binary contains it
- [ ] `logo: "string"` shorthand is normalized at parse time to `{ dark: "string", light: "string" }`
- [ ] `logo: { dark, light }` accepts both keys; missing key falls back to the present one
- [ ] When a logo value is a URL, the interactive viewer renders it directly; for `dict` and `graph` the URL is fetched at generation time and inlined as base64
- [ ] When a logo value is a filepath relative to the models directory, it is read from disk and base64-inlined for static outputs; served via `/api/asset?path=` for the interactive viewer
- [ ] `/api/asset?path=` rejects absolute paths and `..` traversal — refuses with a 400
- [ ] `title` and `subtitle` render top-left across all three surfaces, `position: fixed`, unaffected by graph pan/zoom or dict scroll
- [ ] `title` and `subtitle` are validated at parse time: ≤50 characters each; longer values throw with a clear error
- [ ] Footer renders bottom-center, `position: fixed`, displaying `© {year} {holder}`
- [ ] When `poweredBy` is true (default), the footer additionally renders `powered by Noorm` as an `<a href="https://noorm.dev">` link below the copyright line
- [ ] When `poweredBy` is false, the link is omitted entirely
- [ ] When `copyright.holder` is unset, defaults to "Noorm Ignatius"; when `copyright.year` is unset, uses the current year at generation/serve time
- [ ] Static HTML outputs make zero network requests at view time when the logo is the default OR a filepath — verified by loading the file with all network blocked at the browser level
- [ ] Branding renders correctly in both light and dark modes across all three surfaces — screenshot proof
- [ ] A `tmp/test-branding.yaml` with distinctly non-default values (custom title, subtitle, holder, `poweredBy: false`, custom logo) drives the screenshot evidence
- [ ] Failure modes are loud: URL fetch failure throws with the URL it tried; missing filepath throws with the resolved absolute path; title/subtitle length violation throws with the field name and length


## Approach

(from `docs/design/branding.md` — Approach B: new `_branding.yaml` at models root, symmetric with `_theme.yaml`)


## Checkpoints

| # | Checkpoint | Files / areas | Agent | Est. | Verifies |
|---|------------|---------------|-------|------|----------|
| 1 | Branding schema + parser + defaults + validation | `src/branding-defaults.ts` (new), `src/parse.ts`, `tmp/test-branding-parse.ts` | atomic-builder | ~3 | (1) `parseModels` reads optional `_branding.yaml`, expands string shorthand, merges with defaults; (2) absence yields Noorm-default branding object; (3) title/subtitle >50 chars throws; (4) verification script covers default, custom, shorthand, both shapes, and length-violation cases |
| 2 | Embedded Noorm logo + inlining helper | `assets/noorm-logo.svg` (new, committed), `src/generators/inline-asset.ts` (new), `tmp/test-inline-asset.ts` | atomic-builder | 3 | (1) Noorm SVG committed to repo, imported via `with { type: "file" }` in branding defaults; (2) helper resolves URL → fetch+base64, filepath → read+base64, unset → returns the embedded asset's base64; (3) throws with URL or resolved path on failure; (4) verification covers all input shapes plus failure cases |
| 3 | Interactive UI branding + theme-aware logo swap | `src/App.tsx`, `src/styles.css`, `src/server.ts` (new `/api/asset` route) | atomic-builder | 3 | (1) Top-left fixed div renders `logo`+`title`+`subtitle` from `model.branding`; logo swaps dark↔light based on active theme; (2) bottom-center fixed footer renders copyright; `poweredBy: true` adds the Noorm link, `false` omits it; (3) `/api/asset?path=` serves filepath logos, rejects `..` and absolute; (4) screenshots in dark AND light modes show the rendered branding; custom `tmp/test-branding.yaml` overrides defaults visibly |
| 4 | Dict generator branding | `src/generators/dict.ts` | atomic-builder | 1 | Generated HTML embeds the inlined logo + title + subtitle top-left and the footer at the bottom; `poweredBy` flag respected; verification asserts the HTML contains the expected fragments; screenshot in dark AND light |
| 5 | Graph generator branding | `src/generators/graph.ts` (inherits via embedded React) | atomic-surgeon | 1 | Static graph output has `window.__MODEL__.branding` populated; same React component renders it; screenshot in dark AND light — branding matches the interactive surface |
| 6 | Self-contained verification + screenshot suite | `tmp/test-branding.yaml`, `tmp/test-branding-screenshots.ts` | atomic-builder | 2 | (1) Test branding YAML with non-default title="Acme Schema", subtitle, holder, `poweredBy: false`; (2) Playwright captures 6 screenshots (interactive dark/light, dict dark/light, graph dark/light); (3) static HTML files verified to make zero network requests at view time (Playwright `page.route` blocks all external requests, then loads `file://`) for the default-logo case |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Logo URL fetch fails during static generation (offline, 404, DNS) | Medium | Only applies when user supplies a URL. Default case is offline. Throw with a clear error message naming the URL. |
| User-supplied logo with transparent background unreadable in one theme | Low | User supplies separate `dark`/`light` variants if needed. Documented in README. |
| Footer overlaps with bottom-right FAB on narrow viewports | Medium | Footer max-width + auto margins keeps it centered. FAB stays bottom-right. Verified at default desktop viewport in CP-6. |
| Inlined SVG base64 bloats static output | Low | SVG base64 is typically <5KB. Noorm asset is SVG. Document approximate size impact. |
| `_branding.yaml` schema drift across CLI versions | Medium | Parser validates known fields. Unknown fields surface a warning (not an error). Schema lives in design doc + README. |
| Noorm logo upstream changes (rebrand) leave shipped binaries with stale asset | Low | Committed asset is the source of truth. Manual sync via PR when noormdev rebrands. Acceptable for a project under the same org. |
| `/api/asset?path=` introduces an asset-read surface on the dev server | Low | Path-traversal guard refuses `..` and absolute paths. Dev server is not internet-facing by default. Static outputs use base64 — no server involved. |


## Change log

<!-- empty during drafting; first entry on first post-approval amendment -->


## Implementation log


### v1 — 2026-05-28

Built across 7 iterations of `/subagent-implementation`. Commits (chronological):

- `b79214c` — CP-1 branding schema + parser + defaults + 50-char validation
- `e1f6356` — selective `tmp/` gitignore so CP-1 test fixture is tracked
- `00c5cf1` — CP-2 embedded Noorm SVG + `inline-asset` helper
- `af4879e` — CP-3 interactive UI branding + theme-aware logo swap + `/api/asset` + footer
- `8d575c9` — CP-4 dict branding header + footer
- `e3c37fc` — CP-5 graph branding inherits via embedded Model JSON (no generator change)
- `2f6593a` — CP-6 zero-network proof + screenshot catalog
- `297138b` — polish: closed 17 reviewer follow-ups (F-1..F-16) + fixed `scripts/stable-names.ts` stale-glob bug

**Out-of-scope work performed during this build:**

- `scripts/stable-names.ts` rewrite: was picking alphabetically-first match from stale builds, masking which bundle the build actually emitted. Bonus fix during polish — read `index.html` for authoritative hashed filenames.

**Unforeseens — surprises that emerged during implementation:**

- Initial `tmp/` blanket-ignore from `/atomic-setup` rejected CP-1's tracked test fixture. Replaced with selective rules in `e1f6356`.
- Zero-network proof (CP-6) initially ran against dev imports rather than the compiled binary. Polish iteration (F-15) extended it to `Bun.spawn` the binary directly — the load-bearing offline guarantee.

**Deferred items still open:**

- All 17 reviewer follow-ups closed in `297138b`. None deferred.
- Unrelated: `github-repo-setup-noormdev`, `cut-first-release-v0-1-0` — tracked in project follow-ups, not branding-spec scope.
