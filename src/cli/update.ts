// Self-update: check the latest GitHub release and, with consent, replace the
// running binary in place. Pure helpers (version compare, tag/asset/checksum
// parsing) are exported separately so they can be unit-tested without network.

import { chmodSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { VERSION } from './version';

const REPO = 'noormdev/ignatius';

export interface UpdateCheck {
  current: string;
  latest: string;
  tag: string;
  outdated: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Split "1.2.3" or "v1.2.3" into numeric parts; non-numeric segments → 0. */
export function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** semver-ish compare on major.minor.patch: >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Pull the tag out of a `releases/latest` redirect Location URL. */
export function parseTagFromLocation(location: string): string | null {
  const match = location.match(/\/releases\/tag\/([^/?#]+)/);
  if (!match || !match[1]) return null;
  return decodeURIComponent(match[1]);
}

/** Release asset name for a platform/arch pair, or null if unsupported. */
export function assetForPlatform(platform: string, arch: string): string | null {
  const os =
    platform === 'darwin' ? 'darwin' :
    platform === 'linux' ? 'linux' :
    platform === 'win32' ? 'windows' : null;
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null;
  if (!os || !cpu) return null;
  if (os === 'windows' && cpu !== 'x64') return null; // only x64 windows is shipped
  const suffix = os === 'windows' ? '.exe' : '';
  return `ignatius-${os}-${cpu}${suffix}`;
}

/** Parse a `shasum`-style checksums.txt into an asset → sha256 map. */
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match && match[1] && match[2]) out[match[2]] = match[1].toLowerCase();
  }
  return out;
}

// ── Network + filesystem ──────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchLatestTag(): Promise<string> {
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location) throw new Error('GitHub did not redirect to a release (no Location header)');
  const tag = parseTagFromLocation(location);
  if (!tag) throw new Error(`could not parse a tag from "${location}"`);
  return tag;
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const tag = await fetchLatestTag();
  const latest = tag.replace(/^v/, '');
  return { current: VERSION, latest, tag, outdated: compareVersions(latest, VERSION) > 0 };
}

/**
 * Path of the running compiled binary, or null when launched through a runtime
 * (`bun src/cli/cli.ts` in a dev checkout) where there is no standalone binary to
 * replace.
 */
function runningBinaryPath(): string | null {
  const exe = process.execPath;
  const name = basename(exe).toLowerCase();
  if (name === 'bun' || name === 'bun.exe' || name === 'node' || name === 'node.exe') return null;
  return exe;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/** Download the asset for this platform, verify its checksum, replace `target`. */
async function downloadAndReplace(tag: string, target: string): Promise<void> {
  const asset = assetForPlatform(process.platform, process.arch);
  if (!asset) throw new Error(`no prebuilt binary for ${process.platform}/${process.arch}`);
  const base = `https://github.com/${REPO}/releases/download/${tag}`;

  const binRes = await fetch(`${base}/${asset}`);
  if (!binRes.ok) throw new Error(`download failed (HTTP ${binRes.status}) for ${asset}`);
  const bytes = new Uint8Array(await binRes.arrayBuffer());

  // Verify the checksum when checksums.txt is reachable. A network failure
  // fetching the sums is non-fatal; a genuine mismatch aborts the update.
  try {
    const sumRes = await fetch(`${base}/checksums.txt`);
    if (sumRes.ok) {
      const expected = parseChecksums(await sumRes.text())[asset];
      if (expected) {
        const actual = await sha256(bytes);
        if (actual !== expected) {
          throw new Error(`checksum mismatch for ${asset} (expected ${expected}, got ${actual})`);
        }
      }
    }
  } catch (err) {
    if (errMessage(err).includes('checksum mismatch')) throw err;
    // otherwise: couldn't fetch sums — proceed without verification
  }

  // Stage next to the target (same filesystem) then atomically rename over it.
  // Overwriting a running executable is safe on Unix: the live process keeps the
  // old inode until it exits.
  const tmp = join(dirname(target), `.${basename(target)}.update-${process.pid}`);
  await Bun.write(tmp, bytes);
  chmodSync(tmp, 0o755);
  try {
    renameSync(tmp, target);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

export interface UpdateOptions {
  check?: boolean; // report only, never install
  yes?: boolean;   // skip the confirmation prompt
}

/** Drives `ignatius update`. Returns the process exit code. */
export async function runUpdateCommand(opts: UpdateOptions): Promise<number> {
  let info: UpdateCheck;
  try {
    info = await checkForUpdate();
  } catch (err) {
    process.stderr.write(`Error: could not check for updates — ${errMessage(err)}\n`);
    return 1;
  }

  if (!info.outdated) {
    console.log(`ignatius ${info.current} is up to date.`);
    return 0;
  }

  console.log(`A new version is available: ${info.current} → ${info.latest}`);

  if (opts.check) {
    console.log('Run `ignatius update` to install it.');
    return 0;
  }

  const target = runningBinaryPath();
  if (!target) {
    console.log('Self-update applies to the installed binary only. In a dev checkout, update with git.');
    return 0;
  }

  if (process.platform === 'win32') {
    console.log(
      `Download ignatius-windows-x64.exe from https://github.com/${REPO}/releases/latest ` +
      'and replace your current binary (a running .exe cannot replace itself).',
    );
    return 0;
  }

  if (!opts.yes) {
    if (!process.stdout.isTTY) {
      console.log('Re-run in an interactive terminal, or `ignatius update --yes` to install non-interactively.');
      return 0;
    }
    const { confirm, isCancel } = await import('@clack/prompts');
    const answer = await confirm({ message: `Update to ${info.latest} now?` });
    if (isCancel(answer) || !answer) {
      console.log('Update cancelled.');
      return 0;
    }
  }

  try {
    console.log(`Downloading ignatius ${info.latest}…`);
    await downloadAndReplace(info.tag, target);
  } catch (err) {
    const message = errMessage(err);
    if (/EACCES|EPERM|EROFS|permission|denied/i.test(message)) {
      process.stderr.write(
        `Error: cannot write to ${target} (${message}).\n` +
        'Try: sudo ignatius update --yes\n' +
        `Or reinstall: curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh\n`,
      );
    } else {
      process.stderr.write(`Error: update failed — ${message}\n`);
    }
    return 1;
  }

  console.log(`Updated to ignatius ${info.latest}.`);
  return 0;
}
