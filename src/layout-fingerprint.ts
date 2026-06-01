import type { Model } from './parse';

// FNV-1a 32-bit constants
const FNV_PRIME = 0x01000193;
const FNV_OFFSET_BASIS = 0x811c9dc5;

function fnv1a32(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    // XOR leaves hash as a signed 32-bit int; Math.imul + >>> 0 restores it to unsigned 32-bit.
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Returns a short stable hex string that identifies the structural topology of
 * the model — which nodes (entities) exist and what connects to what.
 *
 * Invariant to non-structural edits: predicate text, columns, pk, ak, body,
 * group, theme, and branding do NOT affect the key.
 *
 * WHY hand-rolled FNV-1a: Bun.hash is a runtime-only API; keeping this pure
 * lets the function be called in any JS environment and makes it trivially
 * unit-testable against Model literals.
 */
export function layoutFingerprint(model: Model): string {
  const nodeIds = model.nodes.map(n => n.id).sort();
  const edgePairs = model.edges.map(e => `${e.source}>${e.target}`).sort();

  const canonical = nodeIds.join(',') + '|' + edgePairs.join(',');
  return fnv1a32(canonical);
}
