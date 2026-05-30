# Ignatius project config (`ignatius.yml`) — spec


## Goal

Introduce `ignatius.yml` as the single per-model config file (meta + theme + branding) and the marker that defines a model root. CLI + server discover models by finding `ignatius.yml`; one is used directly, multiple trigger a picker (`--model <key>` / TTY prompt / non-TTY error). Forward-only: the `_theme.yaml`/`_branding.yaml`/`_meta.yaml` loaders are deleted.


## Non-goals

- No backward compat with the three `_*.yaml` files — they are removed, not deprecated.
- No multi-model serving (one chosen model per server in v1).
- No non-model config (build/output/paths) in `ignatius.yml`.
- No config format other than YAML.
- No reverse/migration tooling (project unpublished).
- No tab completion (`@bomb.sh/tab`) in v1 — citty leaves room for it later; not built now.


## Tooling

- `citty` — CLI framework: `defineCommand` for `serve`/`dict`/`graph`, `runMain` entry. Replaces the hand-rolled `parseArgs` in `src/cli.ts`. Same `bun build --compile src/cli.ts` pipeline.
- `@clack/prompts` — `select` + `isCancel` for the interactive model picker, gated on `process.stdin.isTTY`.
- Both verified to bundle + run in the compiled binary and degrade safely under non-TTY (probe `tmp/probe-cli.ts`).


## Success criteria

- [ ] `parseModels(modelRoot)` reads `modelRoot/ignatius.yml` for theme, branding, and meta; the `_theme.yaml`/`_branding.yaml`/`_meta.yaml` code paths no longer exist (`grep _theme.yaml src/` → 0).
- [ ] An `ignatius.yml` with only `name:` parses; theme/branding default; `grep -r '_theme.yaml\|_branding.yaml\|_meta.yaml' src/` returns nothing.
- [ ] `models/{key-inherited,orm-hybrid,orm-pure}/ignatius.yml` exist, each with a distinct `name`; all three render via discovery (`dict` + `graph` exit 0).
- [ ] Discovery: a base dir containing `ignatius.yml` resolves to itself; a base with no `ignatius.yml` but `ignatius.yml` files below resolves to the set; a base inside a model resolves up to the enclosing root; a base with none errors with a clear message.
- [ ] `ignatius dict models -o out.html` with 3 models present, **non-TTY**, no `--model` → exits non-zero and lists the available keys (`key-inherited`, `orm-hybrid`, `orm-pure`).
- [ ] `ignatius dict models --model orm-pure -o out.html` → renders `orm-pure` with no prompt, in any environment (CI-safe).
- [ ] `ignatius dict models/key-inherited -o out.html` (path is a single model root) → renders it with no prompt.
- [ ] Interactive: in a TTY with multiple models and no `--model`, a `@clack/prompts` `select` lists the models and the selection renders. Verified by a manual TTY run captured in the impl log (automatable checks cover the non-TTY + `--model` paths).
- [ ] `serve` uses the same discovery (single → serve it; multiple → `--model` or prompt or non-TTY error).
- [ ] `cli.ts` is rebuilt on `citty`; the hand-rolled `parseArgs` is gone (`grep parseArgs src/` → 0); `test-cli-parse.ts` is removed or rewritten against the citty surface.
- [ ] The compiled binary (`bun run build:cli`) runs: `--help`, `dict <single-root> -o`, `dict <container> --model <key> -o`, and `dict <container>` non-TTY → exit≠0 + key list.
- [ ] All existing `test/checks/*.ts` pass; `bunx tsc --noEmit` introduces no new errors.
- [ ] CLI `--help` for `serve`/`dict`/`graph` documents the now-optional path arg + `--model <key>`.


## Approaches

| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Discovery in CLI; `parseModels(dir)` stays pure dir-based | `resolveModel()` resolves path/cwd → model root, then calls existing `parseModels` | low | none material |
| B | Discovery inside `parseModels` | parser walks fs + handles TTY | med | pollutes pure parser; breaks 17 dir-based tests |
| CLI-1 | Rebuild `cli.ts` on `citty` | `defineCommand` × 3 + `runMain`; delete `parseArgs` | med | rewrites tested entrypoint; obsoletes `test-cli-parse.ts` |
| PICK-1 | `@clack/prompts` `select`, TTY-gated | real picker + `isCancel`; `--model`/non-TTY bypass | low | interactive render needs manual TTY check |


## Recommendation

**A + CLI-1 + PICK-1** (see `docs/design/ignatius-project-config.md`). `parseModels` keeps its dir-in signature and absorbs the three old loaders into one `ignatius.yml` read; a pure `resolveModel()` (`src/discover.ts`) owns fs-walk resolution; `cli.ts` rebuilt on citty wires the resolver + a TTY-gated clack picker into all three commands. Keeps the parser pure and the 17 `parseModels('models/key-inherited')` tests green. Probe (`tmp/probe-cli.ts`) confirmed citty + clack compile + run + degrade safely under non-TTY.


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | `ignatius.yml` config load — collapse the 3 loaders into one read in `parseModels`; delete `_theme/_branding/_meta` paths; add `ignatius.yml` to the 3 variant roots | `src/parse.ts`, `models/*/ignatius.yml` (3 new), `test/checks/test-config-yaml.ts` (new) | atomic-builder | ~6 | New test: theme+branding+meta load from `ignatius.yml`; only-`name` file defaults the rest; `grep _theme.yaml src/` = 0; 3 variants still render (`dict` exit 0) |
| 2 | `resolveModel()` pure discovery — walk-up + search-down + `--model` resolution; no TTY/citty deps | `src/discover.ts` (new), `test/checks/test-discover.ts` (new) | atomic-builder | ~2 | Unit test over a tmp fixture tree: base-is-root → self; container → N model keys; nested → walk-up; none → error; `--model` selects; basename collision handled; skips `_*`/`node_modules`/`.git`/`dist`/`tmp`/`trash` |
| 3 | Rebuild `cli.ts` on citty + wire resolver + clack picker into `serve`/`dict`/`graph`; delete `parseArgs` + obsolete `test-cli-parse.ts` | `src/cli.ts`, `src/server.ts`, `test/checks/test-cli-discovery.ts` (new) | atomic-builder | ~4 | Compiled binary: `--help` renders; `dict <container> --model orm-pure -o` no prompt; `dict <container>` non-TTY → exit≠0 + key list; `dict <single-root> -o` renders; `serve` resolves; TTY `select` verified manually (impl log); existing `test-cli-binary` behaviors green |
| 4 | Docs — README + CLI usage + signals refresh | `README.md`, `.claude/project/signals.md` | atomic-surgeon | 1-2 | README documents `ignatius.yml` + discovery + `--model`; signals parser/cli/server domains + dep list updated; no broken links |


## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| citty / clack break under `bun build --compile` | Low | Already probed green (`tmp/probe-cli.ts`: `--help` + `--model` + non-TTY all pass in the compiled binary); CP-3 re-confirms on the real `cli.ts` |
| Non-TTY hang waiting on stdin (CI deadlock) | Medium | Gate the clack `select` on `process.stdin.isTTY`; non-TTY ambiguous path errors immediately, never touches stdin (proven in probe T3) |
| citty arg surface diverges from current flags (`-o`, `--theme`, `--port`) | Medium | CP-3 maps each existing flag to a citty `args` entry; `test-cli-binary` behavioral checks guard the contract |
| Discovery glob walks huge trees (node_modules) | Low | Skip `_`-prefixed, `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, `.claude` during search-down |
| `parseModels` callers in tests break if signature changes | Low | Signature is unchanged (still dir-in); only internal config loading changes; the 3 variant dirs gain `ignatius.yml` so reads succeed |
| `--model` key collision (two dirs same basename) | Low | Match on path relative to search base, not just basename, when basenames collide; error if still ambiguous |


## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
