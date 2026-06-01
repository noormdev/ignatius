/**
 * test-serve-port.ts — unit tests for the `serve` port-fallback helpers.
 *
 * Covers the two pieces a user depends on when a port is taken: recognising the
 * "in use" error, and finding the next free port to fall back to.
 *
 * The interactive prompt + retry loop (serveWithPortFallback) is exercised via
 * the compiled binary in test-cli-binary.ts; here we test the pure-ish helpers.
 */

import { findAvailablePort, isAddrInUse } from '../../src/serve-port';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── isAddrInUse ───────────────────────────────────────────────────────────────

{
  assert(isAddrInUse({ code: 'EADDRINUSE' }) === true, 'EADDRINUSE → true');
  assert(isAddrInUse({ code: 'ENOENT' }) === false, 'other code → false');
  assert(isAddrInUse(new Error('boom')) === false, 'plain Error → false');
  assert(isAddrInUse(null) === false, 'null → false');
  assert(isAddrInUse('EADDRINUSE') === false, 'string → false');
  console.log('PASS: isAddrInUse');
}

// ── findAvailablePort ─────────────────────────────────────────────────────────

{
  // Occupy a real port for the duration of the probe so skipping it is deterministic.
  const occupied = Bun.serve({ port: 0, fetch: () => new Response('') });
  const taken = occupied.port;

  const next = findAvailablePort(taken);
  assert(next !== null, 'finds a free port above an occupied one');
  assert(next > taken, `skips the occupied port (taken ${taken}, got ${next})`);

  occupied.stop(true);
  console.log(`PASS: findAvailablePort skipped ${taken} → ${next}`);
}

{
  // No free port in an inverted range → null.
  assert(findAvailablePort(70000, 70010) === null, 'returns null when no port in range is valid');
  console.log('PASS: findAvailablePort returns null when nothing is bindable');
}

console.log('\nAll serve-port assertions passed.');
