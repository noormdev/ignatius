---
type: Domain
description: Default theme palettes, DFD flow-kind colors, and branding config with their deep-merge functions
---

# theme

## What it does

Defines the built-in color/spacing defaults and branding (logo/title/copyright) for the app, and the merge functions that layer a project's `ignatius.yml` `theme:`/`branding:` overrides on top of those defaults. Consumed by [`src/model/parse.ts`](../../src/model/parse.ts), which is the only caller of `mergeTheme`/`mergeBranding`, and by frontend/flow-view rendering code that reads the resulting `ThemeConfig`/`Branding` values.

## CLI code

- [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) — exports `defaultTheme: ThemeConfig`, `mergeTheme()`, `semanticColors`, `defaultFlowKinds`, `FLOW_KIND_KEYS`, `resolveFlowKindPalette()`, and the `ThemeConfig`/`ThemePalette`/`ThemeSpacing`/`ThemeMode`/`FlowKindEntry`/`FlowKindKey` types.
  - `ThemePalette` (per mode `dark`/`light`): `background`, `surface`, `border`, `text`, `textMuted`, `edgeIdentifying`, `edgeReferential`, `pastelMix` (number).
  - `ThemeSpacing`: `nodeSep`, `markerOffset`, `markerScale: [number, number]`.
  - `ThemeConfig`: `{ dark: ThemePalette; light: ThemePalette; spacing: ThemeSpacing; flowKinds?: Partial<Record<FlowKindKey, Partial<{ dark: Partial<FlowKindEntry>; light: Partial<FlowKindEntry> }>>> }`.
  - `defaultTheme` supplies concrete dark/light palettes (e.g. dark `background: '#0e1116'`, light `background: '#ffffff'`) and `spacing: { nodeSep: 60, markerOffset: 10, markerScale: [0.5, 2.5] }`.
  - `semanticColors` maps entity classification names (`independent`, `dependent`, `classifier`, `subtype`, `associative`, plus a `link` color) to `{ bg, fg }` pairs, one full set per `ThemeMode` (`'dark' | 'light'`). Not part of `ThemeConfig` — it is a fixed export, not user-overridable.
  - `FLOW_KIND_KEYS = ['db', 'cache', 'queue', 'file', 'doc', 'manual', 'other', 'external']` and `FlowKindKey` is its element union.
  - `FlowKindEntry = { bg, fg, border }` — one color triple per DFD store/external kind.
  - `defaultFlowKinds: Record<ThemeMode, Record<FlowKindKey, FlowKindEntry>>` holds dark + light entries for all 8 kinds. Per the inline comments, `db` and `external` intentionally keep their pre-existing colors (`db` dark: `bg: '#3d2e00', fg: '#f2d49b', border: '#d29922'`; `external` dark: `bg: '#1a3a1a', fg: '#b7f0c4', border: '#3fb950'`); `cache`/`queue`/`file`/`doc`/`manual`/`other` are new distinct, mode-appropriate colors (amber/violet/lime/sky/rose/slate respectively).
  - `mergeTheme(partial)` shallow-merges `partial.dark`/`partial.light`/`partial.spacing` over `defaultTheme`'s corresponding keys (object-spread, one level deep — not a deep per-field default fallback beyond that), and passes `partial.flowKinds` through as-is (no default-merge at this level) when present, omitting the `flowKinds` key entirely from the result when absent.
  - `resolveFlowKindPalette(mode, flowKinds?)` is the actual deep merge for flow-kind colors: for each key in `FLOW_KIND_KEYS`, if `flowKinds[key][mode]` exists, it spreads that partial `FlowKindEntry` over `defaultFlowKinds[mode][key]`, so a user can override just `bg` without losing `fg`/`border`. Returns `defaultFlowKinds[mode]` unchanged when no `flowKinds` argument is given.
- [`src/theme/branding-defaults.ts`](../../src/theme/branding-defaults.ts) — exports `Branding`, `LogoPair`, `CopyrightConfig` types, `defaultBranding`, and `mergeBranding()`.
  - `LogoPair = { dark: string; light: string }`, `CopyrightConfig = { holder: string; year: number }`, `Branding = { logo: LogoPair; title: string; subtitle: string; copyright: CopyrightConfig; poweredBy: boolean }`.
  - At module load, `noormLogoPath` is imported from [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) via `with { type: 'file' }` (a Bun file import, embedded into the compiled binary at `$bunfs/`), read with `Bun.file(...).arrayBuffer()`, and base64-encoded into `NOORM_DEFAULT_LOGO`, a `data:image/svg+xml;base64,...` URI used for both `logo.dark` and `logo.light` in `defaultBranding`.
  - `defaultBranding`: `title: 'Noorm Ignatius'`, `subtitle: 'Visualize your data model'`, `poweredBy: true`, and a `copyright` getter returning `{ holder: 'Noorm Ignatius', year: new Date().getFullYear() }` (computed per access, not frozen at module load).
  - `mergeBranding(userInput)` accepts `RawBrandingInput` (`logo` as either a bare string or `{ dark?, light? }`, plus `title`, `subtitle`, `copyright`, `poweredBy`, all optional). It throws `Error` if `title` or `subtitle` exceeds 50 characters. `normalizeLogo()` fills a missing `dark`/`light` from the other side, or falls back to `NOORM_DEFAULT_LOGO` if both are absent; an explicit `null` in the object form also falls through to the embedded default (documented in a `WHY` comment). `copyright.holder`/`copyright.year` and `poweredBy` each fall back independently to `defaultBranding`'s values when not supplied.

## Docs

- [`docs/design/branding.md`](../design/branding.md) — design doc for the branding system.
- [`docs/spec/branding.md`](../spec/branding.md) — implementation spec for the branding system.
- [`docs/guides/themes-and-branding.md`](../guides/themes-and-branding.md) — user-facing guide: theme/branding config lives in optional `theme:`/`branding:` blocks in `ignatius.yml`; built-in defaults apply when absent; all subcommands read the same config so the interactive view, data dictionary, and static graph render consistently.

## Coupling

- [`src/model/parse.ts`](../../src/model/parse.ts) is the sole caller of `mergeTheme()` and `mergeBranding()`: `parseModels()` reads `ignatius.yml`, and when it has a `theme:` or `branding:` block, passes it through the respective merge function; otherwise it uses `defaultTheme`/`defaultBranding` directly. `parse.ts` also re-exports the `ThemeConfig` and `Branding` types, so most consumers import these types from `../model/parse` rather than directly from [`src/theme/`](../../src/theme).
- `resolveFlowKindPalette()` is imported directly from [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) (not re-exported through `parse.ts`) by [`src/app/App.tsx`](../../src/app/App.tsx), [`src/app/views/flow/LegendModal.tsx`](../../src/app/views/flow/LegendModal.tsx), [`src/app/views/dict/DictionaryView.tsx`](../../src/app/views/dict/DictionaryView.tsx), and [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) to render DFD flow-kind swatches/legends. `defaultFlowKinds` and `FLOW_KIND_KEYS` are referenced only inside [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) itself and in test files, not by any of those consumers.
- Frontend consumers reading `ThemeConfig`/`ThemePalette`/`semanticColors` values include [`src/app/App.tsx`](../../src/app/App.tsx), [`src/app/hooks/useThemeMode.ts`](../../src/app/hooks/useThemeMode.ts), [`src/app/dom/theme-css-vars.ts`](../../src/app/dom/theme-css-vars.ts), [`src/app/views/graph/markers.ts`](../../src/app/views/graph/markers.ts), [`src/app/views/graph/styles.ts`](../../src/app/views/graph/styles.ts), and [`src/app/views/flow/FlowsView.tsx`](../../src/app/views/flow/FlowsView.tsx) — changing a `ThemePalette`/`ThemeSpacing` field name or shape forces updates across these. [`src/app/components/entity/FlowNodeGridCard.tsx`](../../src/app/components/entity/FlowNodeGridCard.tsx), [`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx), and [`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts) instead import only the `FlowKindKey`/`FlowKindEntry` types from [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts) — changing a `FlowKindEntry` field name or shape forces updates there too. [`src/app/views/dict/DictionaryView.tsx`](../../src/app/views/dict/DictionaryView.tsx) is a mixed case: it imports `resolveFlowKindPalette` as a value (see above) alongside the `FlowKindKey`/`FlowKindEntry` types in the same statement, so it is affected by changes to either.
- Conversely, adding a new theme-configurable value (e.g. a new palette field or a new `FlowKindKey`) requires updating [`src/theme/theme-defaults.ts`](../../src/theme/theme-defaults.ts)'s defaults and merge logic, [`src/model/parse.ts`](../../src/model/parse.ts)'s YAML parsing, and the [`docs/guides/themes-and-branding.md`](../guides/themes-and-branding.md) guide to keep them in sync.
- `branding-defaults.ts` imports [`assets/noorm-logo.svg`](../../assets/noorm-logo.svg) directly (a file-import, not routed through generators), coupling it to Bun's `with { type: 'file' }` embedding behavior relied on by both the dev server and the compiled binary.

## Conventions worth knowing

- The default noorm logo is embedded as a base64 `data:` URI at module load time rather than referenced by path or fetched at runtime, so generated output (including the compiled binary) never needs a network or filesystem request for the default logo. [`test/checks/test-branding-zero-network.ts`](../../test/checks/test-branding-zero-network.ts) verifies this end-to-end (via Playwright, blocking all non-`file://`/`data:` requests) for both the dev `export` path and the compiled binary's `export` output.
- `mergeTheme()` and `resolveFlowKindPalette()` use different merge strategies: `mergeTheme()` does a shallow one-level object-spread per palette (`dark`, `light`, `spacing`), while `resolveFlowKindPalette()` does a per-kind, per-mode `FlowKindEntry`-level merge so a single overridden field (e.g. just `bg`) doesn't drop the rest of that kind's colors.
- `semanticColors` (entity classification colors) is a fixed, non-overridable export — unlike `ThemeConfig` and `flowKinds`, there is no merge function or user-facing config key for it.
