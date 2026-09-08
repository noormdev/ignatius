# Update download progress


## Goal


Show live download progress while `ignatius update` replaces the running binary. Today `downloadAndReplace` buffers the whole asset with `arrayBuffer()` and prints one static `Downloading ignatius <version>…` line, so a ~50MB download looks identical to a hang. Stream the asset instead, count bytes as they arrive, and rewrite a single status line in place until 100%.

The mechanism is the one `atomic` already ships (`internal/selfupdate/selfupdate.go:519`, `cmd/atomic/cmd_update.go:360`): count bytes off the response body and fire a callback every 512KB. No timer, no `stat()` polling.


## Non-goals


- A stall/hang watchdog on the download (a real gap, tracked as a follow-up, not this change).
- Resumable downloads via HTTP range requests.
- Progress for the checksums.txt fetch (a few hundred bytes; noise).
- Changing the update decision, asset naming, checksum, or swap semantics.
- Windows self-replace (still refused with a manual-download message).


## Success criteria


- [ ] `downloadProgressRenderer(write, isTTY)` is exported from `src/cli/update.ts`, pure apart from its injected `write`, and unit-tested.
- [ ] Off-TTY it returns `null`. Without `\r` rewriting, every tick would print its own line into redirected output.
- [ ] Mid-stream with a known total it writes `\rDownloading <recv> / <total> MB (<pct>%)` and does **not** end the line.
- [ ] At `received >= total` it writes a `100%` line terminated with `\n`, then goes quiet. Later calls write nothing.
- [ ] With an unknown total (no `Content-Length`) it writes bare MB and no percent.
- [ ] `downloadAndReplace` streams the response body to the staging file rather than buffering it; the whole asset is never held in memory.
- [ ] sha256 is computed incrementally over the streamed chunks, so the file is never read a second time and no copy is held in memory.
- [ ] Checksum verification still happens **after** download and **before** the rename, and an unreachable checksums.txt is still non-fatal while a genuine mismatch still aborts.
- [ ] A failed or aborted download leaves no staging file behind.
- [ ] `docs/guides/commands.md` describes the progress output; the `docs/wiki/feature-map.md` row for self-update gains its spec surface.
- [ ] `bun run test` passes (`bun run build:cli` first, since the suite asserts on `dist/`), and `bunx tsc --noEmit` reports no *new* errors. This file starts with two pre-existing `TS2339` errors and ends with one: `Bun.CryptoHasher` and `Bun.write` do not resolve off the global `Bun` despite `bun-types` declaring them, and the `Bun.write` call disappears with the buffering path. The runtime is unaffected. Tracked as a follow-up, not fixed here.


## Approaches


| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Stream + byte-threshold callback + `\r` renderer (chosen) | Read `response.body` chunks, write each to the staging file, hash it, emit every 512KB | low | none material; mirrors a mechanism already in production in `atomic` and `noorm` |
| B | Poll the staging file's size on a 100ms timer | `setInterval` + `stat()` until the fetch resolves | low | a second source of truth for "how far along"; timer outlives the download on error; needs its own teardown; still has to buffer or stream underneath |
| C | Keep `arrayBuffer()`, show an indeterminate spinner | Spinner while awaiting | trivial | tells the user nothing they didn't know; still holds ~50MB in memory |


## Recommendation


**A.** The byte count is already flowing through the process. The only reason it isn't visible is that `arrayBuffer()` collapses the whole stream into one await. Reading the body chunk-wise surfaces it for free and drops peak memory from the asset's full size to one chunk. **B** is what the request described, but polling the file re-derives a number the loop already holds, and a timer that must be cleared on every exit path is more moving parts than the counter it replaces. Emitting on a byte threshold rather than a time interval also makes the renderer deterministic to test, with no fake clock.


## Checkpoints


| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Pure `downloadProgressRenderer(write, isTTY)` + unit tests covering off-TTY null, mid-stream no-newline, final 100% + newline, quiet-after-done, unknown-total | `src/cli/update.ts`, new `test/checks/test-update-progress.ts` | atomic-implementer (surgical) | ~2 | `bun test/checks/test-update-progress.ts` green |
| 2 | Stream `downloadAndReplace`: chunk-wise body read to the staging file, incremental sha256, 512KB progress emit, staging cleanup on failure; wire the renderer in `runUpdateCommand` | `src/cli/update.ts` | atomic-implementer (surgical) | 1 | `bun run typecheck`; `bun run test`; asset never buffered whole; verify-before-rename preserved |
| 3 | Document the progress output and close the surface map | `docs/guides/commands.md`, `docs/wiki/feature-map.md` | atomic-implementer (surgical) | ~2 | feature-map row lists the spec; guide describes what the user sees |


## Change log


### 2026-09-08 — typecheck criterion restated

**What changed:** The success criterion read "`bun run typecheck` passes". It now reads "reports no *new* errors", and names the two pre-existing `TS2339` errors this file carries.

**Why:** Correction. The criterion was written before the baseline was measured and was never true. The repo carries 652 pre-existing typecheck errors, two of them in this file, so a green typecheck was never available as a gate.

**Superseded:** the prior contract required a fully green `bun run typecheck`.


### 2026-09-08 — prose and accuracy pass

**What changed:** Em dashes removed from prose throughout. The typecheck criterion no longer cites baseline line numbers, and now states that the file ends the change with one error rather than two.

**Why:** Audit findings. Em dashes in prose break the atomic-writing voice rule, and the `Bun.write` error disappears with the buffering path this change deletes, so the criterion had gone stale against its own implementation.
