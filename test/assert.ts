/**
 * assert.ts — an assertion the check runner can actually see fail.
 *
 * `console.assert` writes its message to stderr and returns; the process still
 * exits 0. The runner is
 *
 *     for f in test/checks/*.ts; do bun "$f" || exit 1; done
 *
 * which reads exit codes and nothing else — so every assertion built on
 * `console.assert` was decorative, printing FAIL into a green build. 177 of them
 * across 11 files were in that state.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so a file still
 * runs to completion and reports EVERY failure instead of stopping at the first
 * — matching how these checks already behaved, minus the lying exit code.
 *
 * `message` is printed verbatim: the existing call sites already embed their own
 * "FAIL: " prefix, and double-prefixing would just add noise.
 *
 * Lives outside `test/checks/` because the runner executes everything in there.
 */
export function assert(condition: unknown, message: string): void {
  if (condition) return;
  console.error(message);
  process.exitCode = 1;
}
