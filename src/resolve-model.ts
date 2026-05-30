/**
 * Shared model-resolution helper for all three CLI subcommands.
 *
 * WHY: Isolated here so @clack/prompts is imported in exactly one place and the
 * TTY-gated `select` is never triggered in CI (spawned processes are non-TTY).
 */
import { resolveModel } from './discover';

/**
 * Resolve a single model directory from a base path + optional --model key.
 *
 * - single match → returns the dir
 * - none         → prints error + process.exit(1)
 * - many + no key, non-TTY  → prints stderr key list + process.exit(2)
 * - many + no key, TTY      → clack `select`; cancel → process.exit(130)
 * - many + key provided     → resolveModel handles filtering; no-match → exit 1
 */
export async function pickModel(base: string, modelKey: string | undefined): Promise<string> {
  const result = await resolveModel(base, { model: modelKey });

  if (result.kind === 'single') {
    return result.model.dir;
  }

  if (result.kind === 'none') {
    process.stderr.write(
      `Error: no ignatius.yml found at, below, or above "${base}".\n` +
      `Create an ignatius.yml in your model directory or pass a path that contains one.\n`,
    );
    process.exit(1);
  }

  if (result.kind === 'no-match') {
    const available = result.available.map(c => c.key).join(', ');
    process.stderr.write(
      `Error: --model "${modelKey}" not found. Available keys: ${available}\n`,
    );
    process.exit(1);
  }

  // kind === 'many'
  const candidates = result.models;
  const keys = candidates.map(c => c.key).join(', ');

  if (!process.stdin.isTTY) {
    process.stderr.write(
      `Error: multiple models found: ${keys}. Pass --model <key>.\n`,
    );
    process.exit(2);
  }

  // TTY: offer an interactive picker — @clack/prompts imported only here
  const { select, isCancel } = await import('@clack/prompts');

  const options = candidates.map(c => ({
    value: c.dir,
    label: c.name ?? c.key,
    hint: c.name !== undefined ? c.key : undefined,
  }));

  const choice = await select({ message: 'Multiple models found — pick one:', options });

  if (isCancel(choice)) {
    process.stderr.write('Cancelled.\n');
    process.exit(130);
  }

  if (typeof choice !== 'string') throw new Error(`Unexpected select result: ${JSON.stringify(choice)}`);
  return choice;
}
