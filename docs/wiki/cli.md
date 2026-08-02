---
type: Domain
description: The ignatius binary — citty subcommands, model-root discovery, port fallback, and self-update.
---

# cli

## What it does

- [`src/cli/cli.ts`](../../src/cli/cli.ts) is the ignatius binary entry point, built on citty (`defineCommand`/`runMain`). It registers `serve`, `server` (alias), `dict`, `graph`, `flow` (removal stubs), `validate`, `export`, `version`, `update`.
- Model-root discovery (`discover.ts`) is a pure, TTY-agnostic helper factored out of the citty command handlers so it can be unit-tested without a terminal; `resolve-model.ts` builds on it but is itself TTY-gated (see below). `serve-port.ts` is unrelated to model-root discovery — it wraps `serveCommand` for port-fallback handling and is separately TTY-gated.
- `update.ts` self-updates the compiled binary against GitHub Releases; `version.ts` bakes the [`package.json`](../../package.json) version into the binary at compile time.

## Artifacts

No user-facing Claude Code skill/command artifacts in this domain.

## CLI code

- [`src/cli/cli.ts`](../../src/cli/cli.ts) — binary entry point. Subcommands:
  - `serve` (alias `server`): positional `path`, `--port`/`-p` (default `3000`, rejected if non-numeric or `<= 0`), `--model`, `--open`/`-o`. Resolves the model dir via `pickModel`, binds via `serveWithPortFallback`; `--open` dynamically imports `open-browser.ts` and calls `openBrowser`.
  - `dict`, `graph`, `flow` — removal stubs. Each writes `"<name> was removed — use: ignatius export -o model.html"` to stderr and exits 1.
  - `validate`: `parseModels()` → `validateModel()`; if `<dir>/flows` exists, dynamically imports `parseFlows()`/`validateFlows()` and folds flow findings into the same report. Prints findings via `formatFindingsForStderr`, prints a one-line `✓`/`✗` stdout summary, exits 1 on error. Error/warning counts come from `RULES[e.ruleId].class` (`B` = error, `A` = warning) rather than each finding's own severity field, so the exit code and the rule registry can't silently diverge.
  - `export`: same parse/validate pipeline as `validate`, plus `-o`/`--out` (required, exits 1 if missing) and `--theme` (`light`|`dark`, default `dark`). Loads the embedded React bundle via `loadEmbeddedBundle()` — on failure, exits 1 with a `bun run build:bundle` hint — then calls `generateApp(model, flowModel, bundle, { themeMode })` and writes one HTML file with `Bun.write`. Exits 1 when entity global errors or flow Class-B errors are present.
  - `version`: prints `VERSION`.
  - `update`: flags `--check`, `--yes`/`-y`; delegates to `runUpdateCommand()` and exits with its returned code.
- [`src/cli/discover.ts`](../../src/cli/discover.ts) — pure model-root resolver (no TTY, citty, clack, or `process.stdin`). Exports `resolveModel(base, opts): Promise<ResolveResult>` (discriminated union `single | many | no-match | none`) and the `ModelCandidate`/`ResolveOptions` types. Algorithm: (1) `base/ignatius.yml` exists → single; (2) else search down, skipping `_`-prefixed dirs and `node_modules`, `.git`, `dist`, `tmp`, [`trash`](../../trash), `.worktrees`, [`.claude`](../../.claude) — a directory containing `ignatius.yml` is treated as a leaf and not recursed into further; (3) 0 found → walk up (optionally bounded by `opts.ceiling`) → single or none; (4) exactly 1 found → single; (5) >1 found + `--model` key → filter to single/no-match/many; (6) >1 found + no key → many.
- [`src/cli/resolve-model.ts`](../../src/cli/resolve-model.ts) — exports `pickModel(base, modelKey): Promise<string>`, the shared resolution+UI layer used by `serve`, `validate`, and `export`. A comment explains the isolation: keeps `@clack/prompts` imported in exactly one place so its TTY-gated `select` is never triggered by a spawned (non-TTY) CI process. `single` → dir; `none` → stderr message + exit 1; `no-match` → stderr with available keys + exit 1; `many` + non-TTY → stderr key list + exit 2; `many` + TTY → clack `select` picker (cancel → exit 130).
- [`src/cli/serve-port.ts`](../../src/cli/serve-port.ts) — `serveWithPortFallback(dir, requestedPort): Promise<number>` wraps `serveCommand` from [`src/server/server.ts`](../../src/server/server.ts). On `EADDRINUSE`: non-TTY stdout silently advances to `port + 1` and retries the real bind (no separate probe, so no check-then-bind race); TTY prompts via `@clack/prompts` `text`, defaulting to the next free port found by `findAvailablePort` (probes by binding and immediately releasing a throwaway `Bun.serve`). Also exports `isAddrInUse(err)`.
- [`src/cli/open-browser.ts`](../../src/cli/open-browser.ts) — `browserOpenCommand(platform, url): string[]` is a pure function: `darwin` → `['open', url]`, `win32` → `['cmd', '/c', 'start', '', url]`, else → `['xdg-open', url]`. `openBrowser(url, platform?)` fire-and-forget `Bun.spawn`s that command, swallowing spawn failures to a stderr message so a missing browser opener (e.g. headless Linux) never takes down the server. Dynamically imported by `cli.ts` only when `--open` is passed.
- [`src/cli/version.ts`](../../src/cli/version.ts) — `export const VERSION: string = pkg.version`, a JSON import of [`package.json`](../../package.json). Bun inlines this at `bun build --compile` time, so the compiled binary reports the version it was built from.
- [`src/cli/update.ts`](../../src/cli/update.ts) — `runUpdateCommand(opts): Promise<number>` drives `ignatius update`. Pure, separately-tested helpers: `parseVersion`, `compareVersions` (major.minor.patch), `parseTagFromLocation` (extracts a tag from GitHub's `releases/latest` redirect `Location` header), `assetForPlatform` (darwin/linux/win32 × arm64/x64; windows only ships x64), `parseChecksums` (parses a shasum-format `checksums.txt`). `checkForUpdate()` resolves the latest version via that redirect, no GitHub API token needed. Guards: dev runtime (`process.execPath` basename is `bun`/`node`) → no self-replace, prints a git-update hint instead; `win32` → prints a manual-download message (a running `.exe` cannot replace itself); non-TTY without `--yes` → report-only. Install path: downloads the platform asset, verifies its sha256 against `checksums.txt` when reachable (a genuine mismatch aborts; an unreachable checksums file does not block the update), writes to a temp file beside the target, `chmodSync 0o755`, then `renameSync` atomically over `process.execPath`.

## Docs

- [`docs/design/cli-and-outputs.md`](../design/cli-and-outputs.md) and [`docs/spec/cli-and-outputs.md`](../spec/cli-and-outputs.md) — design/spec pair for the CLI and its output modes.

## Coupling

- `cli.ts` calls into **server** (`serveCommand` in [`src/server/server.ts`](../../src/server/server.ts), reached through `serve-port.ts`), **parser** (`parseModels` in [`src/model/parse.ts`](../../src/model/parse.ts)), **validate** (`validateModel`, `formatFindingsForStderr`, `RULES` in [`src/model/validate.ts`](../../src/model/validate.ts)), **flows** (`parseFlows` in [`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts), `validateFlows` in [`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts)), and **generators** (`loadEmbeddedBundle` in [`src/generators/embedded-bundle.ts`](../../src/generators/embedded-bundle.ts), `generateApp` in [`src/generators/app.ts`](../../src/generators/app.ts)) — a signature change in any of those exports forces a change in `cli.ts`.
- `validate` and `export` both read `RULES[ruleId].class` from **validate** to decide their exit code — renaming or restructuring the rule-class scheme in [`src/model/validate.ts`](../../src/model/validate.ts) breaks both subcommands' exit-code logic.
- The compiled binary (`bun run build:cli` → `dist/ignatius`) or `bun src/cli/cli.ts` (the `cli` / `dev:cli` package.json scripts) is the only production entry point into this domain. Outside that, four [`test/checks/`](../../test/checks) files import individual [`src/cli/`](../../src/cli) modules directly for unit testing: [`test/checks/test-discover.ts`](../../test/checks/test-discover.ts) imports `resolveModel` from `src/cli/discover`, [`test/checks/test-serve-port.ts`](../../test/checks/test-serve-port.ts) imports `findAvailablePort`/`isAddrInUse` from `src/cli/serve-port`, [`test/checks/test-open-browser.ts`](../../test/checks/test-open-browser.ts) imports `browserOpenCommand` from `src/cli/open-browser`, and [`test/checks/test-update-helpers.ts`](../../test/checks/test-update-helpers.ts) imports helpers from `src/cli/update`.

## Conventions worth knowing

- `@clack/prompts` is imported dynamically, only inside the files that need a TTY prompt (`resolve-model.ts`, `serve-port.ts`, `update.ts`) — kept out of `cli.ts` and out of every non-interactive code path so a CI run can never trigger a TTY-gated prompt.
- Exit-code convention: a cancelled `select` prompt in `resolve-model.ts` or a cancelled `text` prompt in `serve-port.ts` exits 130; "multiple models, can't resolve non-interactively" always exits 2; every other CLI error exits 1. `update.ts`'s `confirm` prompt is the exception — on cancel or decline it logs `Update cancelled.` and returns 0, not 130.
- `dict`, `graph`, and `flow` stay registered as citty subcommands rather than being deleted, purely so they can print a redirect message to `export` — removing them outright would surface citty's generic "unknown command" error instead.
