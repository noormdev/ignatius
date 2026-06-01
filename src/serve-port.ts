// Port selection for `serve`: when the requested port is taken, find the next
// free one and (in a terminal) let the user confirm or override it, instead of
// crashing on EADDRINUSE.

import { serveCommand } from './server';

function hasCode(err: unknown): err is { code: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/** True when an error is a "port already in use" bind failure. */
export function isAddrInUse(err: unknown): boolean {
  return hasCode(err) && err.code === 'EADDRINUSE';
}

/**
 * First bindable port at or above `start`, probed by briefly binding and
 * releasing a throwaway server. Returns null if none are free up to `limit`.
 */
export function findAvailablePort(start: number, limit: number = start + 100): number | null {
  for (let port = start; port <= limit && port <= 65535; port++) {
    try {
      const probe = Bun.serve({ port, fetch: () => new Response('') });
      probe.stop(true);
      return port;
    } catch (err) {
      if (isAddrInUse(err)) continue;
      throw err;
    }
  }
  return null;
}

async function promptForPort(takenPort: number, suggested: number): Promise<number | null> {
  const { text, isCancel } = await import('@clack/prompts');
  const answer = await text({
    message: `Port ${takenPort} is in use. Which port should ignatius use?`,
    placeholder: String(suggested),
    defaultValue: String(suggested),
    validate(value) {
      if (!value) return undefined; // empty input → accept the default
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) {
        return 'Enter a port between 1 and 65535.';
      }
      return undefined;
    },
  });
  if (isCancel(answer)) return null;
  return Number(answer);
}

/**
 * Start the server on `requestedPort`, recovering when it is taken:
 *   - terminal: ask which port to use, defaulting to the next free one
 *   - non-interactive: advance to the next port and retry, logging the choice
 * Loops until a bind succeeds. Exits 130 if the user cancels the prompt.
 */
export async function serveWithPortFallback(dir: string, requestedPort: number): Promise<void> {
  let port = requestedPort;
  while (true) {
    try {
      serveCommand(dir, { port });
      return;
    } catch (err) {
      if (!isAddrInUse(err)) throw err;

      // Non-interactive (CI, pipes): silently walk to the next port and retry
      // the real bind — no probe, so there is no check-then-bind race.
      if (!process.stdout.isTTY) {
        const next = port + 1;
        if (next > 65535) {
          process.stderr.write(`Error: no available port at or above ${requestedPort}.\n`);
          process.exit(1);
        }
        process.stderr.write(`Port ${port} is in use — trying ${next}.\n`);
        port = next;
        continue;
      }

      // Terminal: suggest the next free port and let the user choose.
      const suggested = findAvailablePort(port + 1) ?? port + 1;
      const chosen = await promptForPort(port, suggested);
      if (chosen === null) {
        process.stderr.write('Cancelled.\n');
        process.exit(130);
      }
      port = chosen;
    }
  }
}
