---
type: Domain
description: Static self-contained HTML export — the sole `generateApp` generator plus embedded/on-disk bundle loading.
---

# generators

## What it does

[`src/generators/`](../../src/generators) produces the self-contained HTML file written by the CLI's `export` command. There is exactly one generator, `generateApp`, which injects the full union of runtime globals needed by the unified React SPA (Graph, Dictionary, Flows) into one file; there is no separate graph/dict/flow generator. [`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) supplies the HTML/JS/CSS bundle content that `generateApp` inlines, either from the compiled binary's embedded files or from `dist/static/` on disk.

## Artifacts

Omitted — no user-facing Claude Code skill/command artifacts in this domain.

## CLI code

- [`src/generators/app.ts`](../../src/generators/app.ts) (143 lines) — `generateApp(model, flowModel, sourceOrDir, opts)` returns the final HTML string as a `Promise<string>`. It resolves `sourceOrDir` (default `'dist/static'`) to a `BundleContent` via `loadBundleFromDir` when given a string, or uses it directly when already a `BundleContent`. It builds one `<script>` block that sets `window.__IGNATIUS_MODE__ = "static"`, `window.__MODEL__`, and — only when `flowModel !== null && flowModel.diagrams.length > 0` — `window.__FLOW_MODEL__` and `window.__FLOW_LAYOUT_KEYS__` (via `buildFlowLayoutKeys`), then always `window.__LAYOUT_KEY__` (via `layoutFingerprint(model)`) and `window.__THEME_MODE__` (`opts.themeMode`, default `'dark'`). It swaps the template's external `<link rel="stylesheet" href=".../index-*.css">` for an inlined `<style>` block, and its `<script type="module" src=".../index-*.js">` for the injection script followed by an inlined `<script type="module">`. It strips the bundle's live-mode boot script (`window.__IGNATIUS_MODE__ = 'live';`) so the static injection's value wins. It rewrites `<title>` to the model's display name (`model._meta?.name`, falling back to `'Ignatius'`), HTML-escaping `&`, `<`, `>` via a local `escapeHtmlText`. A separate local `escapeScriptClose` escapes `</script` sequences (case-insensitive) inside injected JSON so flow-body markdown containing a literal `</script>` cannot break out of the enclosing `<script>` tag; the JS bundle itself is separately escaped for the same `</script>` pattern before being inlined.
- [`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts) (119 lines) — defines `BundleContent = { htmlTemplate, cssContent, jsContent }` (all raw strings). `loadBundleFromDir(bundleDir)` reads `index.html` from `bundleDir`, extracts the hashed JS/CSS filenames (`index-<hash>.js` / `.css`) via regex against the `src=`/`href=` attributes, falls back to a `Glob('index-*.{js,css}')` scan of the directory if the regex misses, and throws a descriptive error (naming the exact `bun build` command and listing the directory's actual contents) if either file still can't be found. `loadEmbeddedBundle()` is the compiled-binary path: it imports `dist/static/index.html`, `dist/static/index.js`, `dist/static/index.css` at module load time with `with { type: 'file' }` so `bun build --compile` embeds them under `$bunfs/`, checks all three exist via `Bun.file().exists()`, and throws pointing at `bun run build:bundle` (or `build:cli`) if any are missing.

## Docs

- [`docs/guides/commands.md`](../guides/commands.md) — the `## export` section (around line 49) documents the CLI-facing behavior: one self-contained HTML file with Graph, Dictionary, and Flows, working offline from `file://`, and notes the export injects both the entity and flow models so both position-restore keys work without a server. It also notes the retired `dict`/`graph`/`flow` subcommands now error and point to `export`.
- [`docs/guides/building-from-source.md`](../guides/building-from-source.md) — its source-layout table lists [`src/generators/`](../../src/generators) as "Static output for `export`".

## Coupling

- **parser** ([`src/model/`](../../src/model)) — `generateApp` takes a `Model` (from [`src/model/parse.ts`](../../src/model/parse.ts)) and calls `layoutFingerprint` (from [`src/model/layout-fingerprint.ts`](../../src/model/layout-fingerprint.ts)) directly; a change to either's shape or signature is a breaking change here.
- **flows** ([`src/flows/`](../../src/flows)) — `generateApp` takes a `FlowModel | null` (from [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts)) and calls `buildFlowLayoutKeys` (from [`src/flows/flow-fingerprint.ts`](../../src/flows/flow-fingerprint.ts)); the same coupling applies.
- **frontend** ([`src/app/`](../../src/app)) — `embedded-bundle.ts` imports the *compiled output* of the frontend (`dist/static/index.html`/`.js`/`.css`), not its source, so a source-level React change only reaches this domain after a `bun run build:bundle`. `app.ts`'s regex-based `<link>`/`<script>` replacement and its `window.__IGNATIUS_MODE__ = 'live';` strip both depend on the exact markup shape [`src/app/index.html`](../../src/app/index.html) compiles down to; a template restructure there can silently break the string replacement (the regexes would simply fail to match).
- **cli** ([`src/cli/`](../../src/cli)) — [`src/cli/cli.ts`](../../src/cli/cli.ts) is the only caller of both `loadEmbeddedBundle` (line 248) and `generateApp` (line 260), invoked from the `export` command; it dynamically `import()`s both rather than importing them statically at module top.
- No other domain imports from [`src/generators/`](../../src/generators).

## Conventions worth knowing

- This is a two-file domain by design: the doc comment atop `app.ts` states explicitly there is no `graph.ts` or `flow-graph.ts` to import from — both were removed when the SPA was unified into one `generateApp`, and any future split-view generator would be a deliberate reversal of that decision.
- Two distinct escaping helpers exist for two distinct reasons and are not interchangeable: `escapeScriptClose` neutralizes `</script` inside a `<script>` body (JSON payloads, the inlined JS bundle), while `escapeHtmlText` escapes `&`/`<`/`>` for HTML text content (the `<title>` rewrite only).
- All regex-based template surgery in `app.ts` (stylesheet swap, module-script swap, live-mode-script strip, title rewrite) uses function-form replacements (`.replace(pattern, () => ...)`) rather than a string second argument — required because the injected content (minified JS, arbitrary model JSON) can itself contain `$`-prefixed patterns that `String.prototype.replace` would otherwise interpret as substitution tokens.
- Covered by [`test/checks/test-app-title.ts`](../../test/checks/test-app-title.ts), [`test/checks/test-branding-zero-network.ts`](../../test/checks/test-branding-zero-network.ts), [`test/checks/test-graph-branding.ts`](../../test/checks/test-graph-branding.ts), [`test/checks/test-layout-key-injection.ts`](../../test/checks/test-layout-key-injection.ts), and [`test/checks/test-app-gen-zero-diagrams.ts`](../../test/checks/test-app-gen-zero-diagrams.ts) (pins that a `FlowModel` with zero diagrams is treated identically to `flowModel === null` — neither injects `__FLOW_MODEL__`/`__FLOW_LAYOUT_KEYS__`), run via `bun run test` (a shell loop over `test/checks/*.ts`), not `bun test`/`bun:test`.
