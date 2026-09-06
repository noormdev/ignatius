/**
 * test-router-fingerprint.ts — verifies the SHA-256 fingerprint primitives
 * behind the router's digest roll-up (spec SC7): every row hashes its
 * target, a folder digest hashes its ordered row-hash list, and a change to
 * one leaf changes its folder digest and every ancestor digest, and no
 * sibling digest.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { folderDigest, hashFile } from '../../src/router/fingerprint';
import { assert } from '../assert';

const BASE_TMP = resolve(import.meta.dir, '../../tmp/fixtures/router-fingerprint-test');
rmSync(BASE_TMP, { recursive: true, force: true });
mkdirSync(BASE_TMP, { recursive: true });

// 1 — hashFile is deterministic and content-sensitive
{
  const file = `${BASE_TMP}/a.md`;
  writeFileSync(file, 'hello');
  const first = await hashFile(file);
  const second = await hashFile(file);
  assert(first === second, 'FAIL(1): hashFile should be deterministic for unchanged bytes');
  assert(/^sha256:[0-9a-f]{64}$/.test(first), `FAIL(1): expected sha256:<hex>, got ${first}`);

  writeFileSync(file, 'hello!');
  const third = await hashFile(file);
  assert(first !== third, 'FAIL(1): hashFile should change when file bytes change');
}

// 2 — folderDigest hashes the ordered row-hash list; order matters
{
  const digestAB = folderDigest(['hash-a', 'hash-b']);
  const digestBA = folderDigest(['hash-b', 'hash-a']);
  const digestAB2 = folderDigest(['hash-a', 'hash-b']);
  assert(digestAB === digestAB2, 'FAIL(2): folderDigest should be deterministic for the same ordered list');
  assert(digestAB !== digestBA, 'FAIL(2): folderDigest should be order-sensitive');
  assert(/^sha256:[0-9a-f]{64}$/.test(digestAB), `FAIL(2): expected sha256:<hex>, got ${digestAB}`);
}

// 3 — ancestor-only propagation on a synthetic tree:
//
//   root/
//     groupA/leaf1.md, leaf2.md
//     groupB/leaf3.md
//
// editing leaf1 changes groupA's digest and the root digest, and leaves
// groupB's digest untouched.
{
  const groupA = `${BASE_TMP}/groupA`;
  const groupB = `${BASE_TMP}/groupB`;
  mkdirSync(groupA, { recursive: true });
  mkdirSync(groupB, { recursive: true });

  const leaf1 = `${groupA}/leaf1.md`;
  const leaf2 = `${groupA}/leaf2.md`;
  const leaf3 = `${groupB}/leaf3.md`;
  writeFileSync(leaf1, 'one');
  writeFileSync(leaf2, 'two');
  writeFileSync(leaf3, 'three');

  async function digests() {
    const groupADigest = folderDigest([await hashFile(leaf1), await hashFile(leaf2)]);
    const groupBDigest = folderDigest([await hashFile(leaf3)]);
    const rootDigest = folderDigest([groupADigest, groupBDigest]);
    return { groupADigest, groupBDigest, rootDigest };
  }

  const before = await digests();

  writeFileSync(leaf1, 'one, edited');

  const after = await digests();

  assert(before.groupADigest !== after.groupADigest, 'FAIL(3): editing leaf1 should change groupA digest');
  assert(before.rootDigest !== after.rootDigest, 'FAIL(3): editing leaf1 should change the root digest');
  assert(before.groupBDigest === after.groupBDigest, 'FAIL(3): editing leaf1 must not change groupB digest, a sibling');
}

console.log('test-router-fingerprint: OK');
