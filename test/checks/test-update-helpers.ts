/**
 * test-update-helpers.ts — unit tests for the pure helpers behind `ignatius update`.
 *
 * These cover the logic a user depends on for a correct update decision and a
 * correct download target, with no network: version comparison, tag extraction
 * from the GitHub redirect, platform→asset mapping, and checksums parsing.
 *
 * The network + self-replace paths in update.ts are exercised manually against a
 * real release; they are not unit-tested here.
 */

import {
  parseVersion,
  compareVersions,
  parseTagFromLocation,
  assetForPlatform,
  parseChecksums,
} from '../../src/update';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── parseVersion ──────────────────────────────────────────────────────────────

{
  assert(JSON.stringify(parseVersion('1.2.3')) === JSON.stringify([1, 2, 3]), 'parseVersion 1.2.3');
  assert(JSON.stringify(parseVersion('v0.3.0')) === JSON.stringify([0, 3, 0]), 'parseVersion strips leading v');
  assert(JSON.stringify(parseVersion('2.0')) === JSON.stringify([2, 0]), 'parseVersion two segments');
  console.log('PASS: parseVersion');
}

// ── compareVersions ───────────────────────────────────────────────────────────

{
  assert(compareVersions('0.3.0', '0.0.1') > 0, 'newer > older');
  assert(compareVersions('0.0.1', '0.3.0') < 0, 'older < newer');
  assert(compareVersions('1.0.0', '1.0.0') === 0, 'equal === 0');
  assert(compareVersions('v1.2.0', '1.1.9') > 0, 'v-prefixed compares numerically');
  assert(compareVersions('1.2', '1.2.0') === 0, 'missing patch treated as 0');
  // Numeric, not lexical: 10 > 9.
  assert(compareVersions('1.10.0', '1.9.0') > 0, '1.10.0 > 1.9.0 (numeric)');
  console.log('PASS: compareVersions');
}

// ── parseTagFromLocation ──────────────────────────────────────────────────────

{
  assert(
    parseTagFromLocation('https://github.com/noormdev/ignatius/releases/tag/v0.3.0') === 'v0.3.0',
    'extracts tag from redirect URL',
  );
  assert(
    parseTagFromLocation('https://github.com/x/y/releases/tag/v1.0.0?utm=1') === 'v1.0.0',
    'extracts tag with trailing query',
  );
  assert(parseTagFromLocation('https://github.com/x/y/releases') === null, 'no tag → null');
  console.log('PASS: parseTagFromLocation');
}

// ── assetForPlatform ──────────────────────────────────────────────────────────

{
  assert(assetForPlatform('darwin', 'arm64') === 'ignatius-darwin-arm64', 'darwin arm64');
  assert(assetForPlatform('darwin', 'x64') === 'ignatius-darwin-x64', 'darwin x64');
  assert(assetForPlatform('linux', 'arm64') === 'ignatius-linux-arm64', 'linux arm64');
  assert(assetForPlatform('linux', 'x64') === 'ignatius-linux-x64', 'linux x64');
  assert(assetForPlatform('win32', 'x64') === 'ignatius-windows-x64.exe', 'windows x64 gets .exe');
  assert(assetForPlatform('win32', 'arm64') === null, 'windows arm64 unsupported');
  assert(assetForPlatform('freebsd', 'x64') === null, 'unknown OS unsupported');
  assert(assetForPlatform('darwin', 'ia32') === null, 'unknown arch unsupported');
  console.log('PASS: assetForPlatform');
}

// ── parseChecksums ────────────────────────────────────────────────────────────

{
  const sha = 'a'.repeat(64);
  const shb = 'b'.repeat(64);
  const text = `${sha}  ignatius-darwin-arm64\n${shb} *ignatius-linux-x64\n\n# comment line\n`;
  const map = parseChecksums(text);
  assert(map['ignatius-darwin-arm64'] === sha, 'parses two-space sha line');
  assert(map['ignatius-linux-x64'] === shb, 'parses binary-marker (*) line');
  assert(map['#'] === undefined && Object.keys(map).length === 2, 'ignores blank and non-checksum lines');
  console.log('PASS: parseChecksums');
}

console.log('\nAll update-helper assertions passed.');
