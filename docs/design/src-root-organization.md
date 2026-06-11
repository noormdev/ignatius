# src/ root organization

## Problem

After the App.tsx decomposition, `src/` root still holds 27 loose files spanning five domains (CLI, server, model core, flows core, theme) plus frontend strays. The signals file names these domains; the directory layout doesn't. The Bun-side vs browser-safe boundary is invisible at a glance.

## Goals / Non-goals

Goals:

- `src/` root contains only directories: `app/`, `cli/`, `server/`, `model/`, `flows/`, `theme/`, `generators/`, `flow-view/`, `types/`.
- Frontend-only strays (`hash-router`, `markers`, `wrap-label`, `layout-store`, `main.tsx`, `index.html`, `styles.css`) move inside `src/app/`.
- Pure moves + import-path updates. Zero behavior change.

Non-goals:

- Renaming any exported symbol.
- Touching `generators/`, `flow-view/`, `types/` contents.
- Splitting `styles.css`.
- Barrel files (`index.ts` re-exports) — direct imports stay direct.

## Placement decisions (from conversation, evidence = signals import map)

| File(s) | Destination | Why |
|---------|------------|-----|
| cli.ts, discover.ts, resolve-model.ts, serve-port.ts, open-browser.ts, version.ts, update.ts | `cli/` | binary-side, citty dispatch + CLI UX |
| server.ts | `server/` | own domain per signals; only launched by CLI but conceptually distinct |
| parse.ts, validate.ts, model-index.ts, wikilink.ts, layout-fingerprint.ts | `model/` | entity-model core; layout-fingerprint fingerprints a Model (shared by server + generators + app) |
| flow-parse.ts, flow-validate.ts, flow-fingerprint.ts, flow-usage-index.ts, titlelize.ts | `flows/` | DFD core; titlelize imported by flow-parse only |
| theme-defaults.ts, branding-defaults.ts | `theme/` | theme/branding config + types |
| hash-router.ts | `app/` | imported only by frontend |
| markers.ts, wrap-label.ts, layout-store.ts | `app/views/graph/` | cy overlay, label wrapping, position persistence — graph-view-only |
| main.tsx, index.html, styles.css | `app/` | bundle entry colocated with the app it boots |

## Approaches

| # | Approach | Pros | Cons |
|---|----------|------|------|
| A | **Domain dirs as above, checkpointed moves** | matches signals domains; Bun/browser boundary visible; proven gate pattern | ~109 test-script imports + package.json/index.html churn |
| B | Leave root flat | zero churn | the problem persists |
| C | Two-bucket split (`core/` vs `app/`) only | less churn | hides the five real domains; half-measure |

## Recommendation

A. The decomposition branch already proved the gate pattern (typecheck baseline, 54 checks, build, visual sentinels) makes mechanical moves safe at this scale. Churn is one-time; the org is permanent.

## Open questions

- none — placement calls resolved above.
