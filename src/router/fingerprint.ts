/**
 * fingerprint.ts — SHA-256 primitives behind the router's digest roll-up.
 * Every row hashes its target's raw bytes (not normalized text, so a
 * whitespace-only edit still dirties the digest); a folder digest hashes
 * its ordered row-hash list, so a leaf change propagates to its folder and
 * every ancestor, and to no sibling.
 */

function sha256Hex(bytes: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex');
}

/** SHA-256 of a file's raw bytes, as `sha256:<hex>`. */
export async function hashFile(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return `sha256:${sha256Hex(bytes)}`;
}

/** SHA-256 of an ordered row-hash list, as `sha256:<hex>`. Order-sensitive. */
export function folderDigest(rowHashes: string[]): string {
  return `sha256:${sha256Hex(rowHashes.join('\n'))}`;
}

/** One router row: a child folder or a leaf entity/process/external/store. */
export interface RouterNode {
  name: string;
  kind: string;
  description: string;
  link: string;
  hash: string;
}
