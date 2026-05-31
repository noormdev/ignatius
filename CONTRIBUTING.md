# Contributing

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) so [release-please](https://github.com/googleapis/release-please) can generate the CHANGELOG and version bumps automatically.

Use these prefixes:

| Prefix | Bumps version | Example |
|---|---|---|
| `fix:` | patch (0.0.x) | `fix(server): close fs.watch on shutdown` |
| `feat:` | minor (0.x.0) | `feat(cli): add --theme flag` |
| `feat!:` or `BREAKING CHANGE:` footer | major (x.0.0) | `feat(api)!: rename /api/model to /api/schema` |
| `docs:`, `chore:`, `style:`, `refactor:`, `test:`, `ci:` | no bump | `docs(spec): clarify subtype rendering` |

While `0.x.y`, breaking changes bump the minor (not the major). Once we hit `1.0.0`, breaking changes bump the major.

## Release flow

You don't manually tag or release. The pipeline does it:

1. Land your conventional-commit PRs on `main`.
2. The **release-please** workflow opens (or updates) a release PR that bumps the version and the CHANGELOG based on commits since the last release.
3. When the release PR is merged, release-please creates a `v*` tag.
4. The **release** workflow fires on that tag, cross-compiles the binary for darwin-arm64, darwin-x64, linux-x64, linux-arm64, and windows-x64, and attaches them plus a `checksums.txt` to the GitHub Release.

## CI

Every push and PR runs the CI workflow: install deps, build the React bundle, compile the binary, then run every check under `test/checks/` plus a typecheck. Playwright's Chromium headless shell is cached by `bun.lock` hash.

## Tests

There's no test framework — tests are raw assertion scripts under `test/checks/`. Run a single one:

```bash
bun test/checks/test-cli-validate.ts
```

Or all of them:

```bash
bun run test
```

A test passes if it exits 0 with no thrown error.

## Local dev

```bash
bun run dev:cli   # CLI in serve mode with hot reload, against the bundled models/
bun run dev       # raw server entry, also hot reload
bun run build:cli # full production build → ./dist/ignatius
```
