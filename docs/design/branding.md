# Branding system


## Problem

Every ignatius output looks generic today — no logo, no project name on the page, no provenance. Users authoring schemas for their organization want their brand on the data dictionary they share with colleagues. The tool also surfaces Noorm attribution by default since ignatius lives under the noormdev umbrella.

The three output surfaces — interactive viewer, static dict HTML, static graph HTML — must share one branding contract. Static outputs need to be self-contained: opening a generated HTML offline must show the logo with no broken-image placeholder.


## Goals

- One config file at the models root drives branding for every surface.
- Logo + title + subtitle pinned upper-left, immune to pan/zoom.
- Footer at bottom-center, fixed, displaying user copyright + (by default) a "powered by Noorm" link that the user can disable.
- Sensible default: when the user supplies no branding, the page brands as Noorm Ignatius with the Noorm logo. Default case works offline.
- Static outputs are self-contained: logos inlined as base64 at generation time.
- Theme-aware: logo can have separate dark/light variants, with a string shorthand for the same-asset case.


## Non-goals

- Per-page or per-entity branding overrides. One brand per model.
- Custom CSS or arbitrary HTML injection.
- Logo upload UI. User authors YAML.
- Dynamic logo themeing (auto-tinting). User supplies both variants if they need them.
- Brand styling of node fills, edges, group colors. That stays in `_theme.yaml`.


## Approaches

| # | Approach | Pros | Cons |
|---|----------|------|------|
| A | Extend `models/_meta.yaml` with branding fields | Single file for model-level metadata. Fewer files at the root. | `_meta.yaml` exists for data dictionary audit fields (name, version, desc, updated). Mixing presentation into it conflates concerns. A user who only wants branding still has to acknowledge the dictionary schema. |
| B | New `models/_branding.yaml` alongside `_theme.yaml` | Symmetric with the theme pattern. Clear separation: metadata = documentation, branding = presentation. Discoverable by filename. | One more file. One more parse path. |
| C | Single `models/_config.yaml` holding theme and branding | Simplest mental model from one angle. | Breaks the existing per-concept-file convention. Forces re-shaping `_theme.yaml`, which is already shipped. |


## Recommendation

**Approach B — new `models/_branding.yaml`.**

Evidence: the parser already implements the "optional `_*.yaml` at models root" pattern for `_theme.yaml` and `_meta.yaml` (`src/parse.ts:114-135` for theme, `:207-213` for meta). Branding parallels theme — both are presentation config, both are optional, both fall back to defaults. Symmetric naming lets users learn one convention and apply it everywhere.

`_meta.yaml` should keep its current purpose: documentation metadata that ships in the data dictionary itself (model name, version, last-updated). Branding belongs to the rendering pipeline, not the data dictionary content.


## Schema

```yaml
# models/_branding.yaml (optional)

# Logo: string shorthand OR explicit per-mode object.
# Each value can be a URL or a filepath relative to the models directory.
# Falls back to the embedded Noorm logo when absent.
logo: "./assets/logo.svg"          # shorthand: same asset for both modes
# OR
logo:
  dark: "./assets/logo-dark.svg"
  light: "./assets/logo-light.svg"

title: "Acme Schema"                # max 50 chars; defaults to "Noorm Ignatius"
subtitle: "Internal data model"     # max 50 chars; optional

copyright:
  holder: "Acme Corp"               # defaults to "Noorm Ignatius"
  year: 2026                        # defaults to current year at generation/serve time

poweredBy: true                     # default true; set false to omit the Noorm link
```


## Defaults (when the file is absent OR a field is unset)

```yaml
logo: <embedded Noorm SVG used for both dark and light>
title: "Noorm Ignatius"
subtitle: "Visualize your data model"
copyright:
  holder: "Noorm Ignatius"
  year: <current>
poweredBy: true
```


## The "powered by" default

The footer renders `powered by [Noorm](https://noorm.dev)` after the user's copyright line **by default**. Users can opt out by setting `poweredBy: false` in their `_branding.yaml`. The framing:

- Default true. Strong default, not a contract.
- Same in light and dark themes when rendered.
- User-controllable. No technical enforcement — just markup.

This handles the noormdev umbrella positioning by default while leaving room for users in regulated environments to disable external links.


## Layout

```
┌─────────────────────────────────────────────────┐
│ [logo] Title                          [☀ / ☾]   │ ← top-left fixed branding,
│        Subtitle                                  │   top-right is the theme toggle
│                                                  │
│                                                  │
│                  [graph or content]              │
│                                                  │
│                                                  │
│                                                  │
│              © 2026 Acme Corp                    │ ← bottom-center fixed footer,
│              powered by Noorm                    │   bottom-right is the FAB
│                                       [legend]   │   (poweredBy: false omits line 2)
└─────────────────────────────────────────────────┘
```

The branding block is `position: fixed`. The footer is `position: fixed; bottom: 0;` with auto horizontal margins so it stays centered. The FAB and theme toggle stay where they are — no overlap because the footer is centered.

Static surfaces (dict, graph) follow the same layout. The dict page is a long scrolling document, so the branding+footer stay pinned to viewport, not document — that's the whole point of fixed positioning.


## Logo handling

Input shapes (after shorthand expansion):

```typescript
{ dark: string | undefined, light: string | undefined }
```

Each value can be:

1. **URL** (`"https://..."` or `"http://..."`):
   - Interactive viewer: used directly in `<img src>`. Browser fetches at page load.
   - Static outputs (dict, graph): fetched at generation time, converted to base64, inlined.

2. **Filepath** (relative to the models directory, e.g. `"./assets/logo.svg"`):
   - Interactive viewer: served via `/api/asset?path=...` from the server.
   - Static outputs: read from disk, base64-inlined.

3. **Unset / null**:
   - Falls back to the embedded Noorm SVG. No network access for this case.

The Noorm SVG is committed to the repo and imported at compile time via Bun's `with { type: "file" }` attribute, the same mechanism that embeds the React bundle. It is NOT fetched at runtime.

Shorthand expansion: `logo: "./x.svg"` is normalized at parse time to `{ dark: "./x.svg", light: "./x.svg" }`. If only one variant is supplied in the object form, the other falls back to it.

Failure modes during static generation:
- Network failure or 404 on URL fetch → throw with a clear error naming the URL.
- Filepath not found → throw with the resolved absolute path.

Document that `dict` and `graph` commands require network access only when the user supplies a URL — the default case is offline-capable.


## Theme integration

- Text colors (title, subtitle, footer) read from theme CSS vars — `--color-text`, `--color-text-muted`.
- Logo: theme toggle swaps `logo.dark` ↔ `logo.light` automatically. If the user provided a string shorthand, the same asset shows in both modes.


## Open questions

None. All schema, fallback, opt-out, and validation behavior is settled.
