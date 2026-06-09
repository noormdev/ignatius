import type { FlowDiagram, FlowModel } from './flow-parse';

// FNV-1a 32-bit constants — identical to layout-fingerprint.ts.
const FNV_PRIME = 0x01000193;
const FNV_OFFSET_BASIS = 0x811c9dc5;

function fnv1a32(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Returns a short stable hex string identifying the structural topology of a
 * single FlowDiagram — which processes/externals/store-refs exist and what
 * connects to what.
 *
 * Invariant to non-structural edits: process labels, body text, column names
 * in `data`, local/composed numbers, and theme do NOT affect the key.
 *
 * Sensitive to: adding/removing a process, external, store ref, or flow edge.
 *
 * WHY resolved kind:name (not raw): spelling variants that point at the same
 * resolved endpoint (e.g. bare "Shopper" vs qualified "ext:Shopper") must
 * produce the same key — the topology is identical; the authored string is not.
 *
 * WHY hand-rolled FNV-1a: Bun.hash is a runtime-only API; keeping this pure
 * lets the function be called in any JS environment and makes it trivially
 * unit-testable against FlowDiagram literals (same rationale as layoutFingerprint).
 *
 * NOT imported by App.tsx — the frontend reads keys from the
 * window.__FLOW_LAYOUT_KEYS__ map (static) or the /api/flow payload's
 * flowLayoutKeys field (live). Imported by src/generators/app.ts and
 * src/server.ts (via buildFlowLayoutKeys) to build the id→fingerprint map.
 */
/**
 * Recursively collect layout fingerprints for a diagram and all its sub-DFDs.
 * Returns a flat id→fingerprint map covering every diagram in the tree.
 */
function collectFlowLayoutKeys(diagram: FlowDiagram): Record<string, string> {
  const keys: Record<string, string> = {};
  keys[diagram.id] = layoutFlowFingerprint(diagram);
  for (const sub of diagram.subDfds) {
    const subKeys = collectFlowLayoutKeys(sub);
    for (const [id, key] of Object.entries(subKeys)) {
      keys[id] = key;
    }
  }
  return keys;
}

/**
 * Build the complete id→fingerprint map for every diagram in a FlowModel
 * (top-level DFDs and all sub-DFDs recursively).
 *
 * Used by src/server.ts (/api/flow route) and src/generators/app.ts (export).
 */
export function buildFlowLayoutKeys(flowModel: FlowModel): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const diagram of flowModel.diagrams) {
    const subKeys = collectFlowLayoutKeys(diagram);
    for (const [id, key] of Object.entries(subKeys)) {
      keys[id] = key;
    }
  }
  return keys;
}

export function layoutFlowFingerprint(diagram: FlowDiagram): string {
  const processIds = diagram.processes.map(p => p.id).sort();
  const externalIds = diagram.externals.map(e => e.id).sort();
  const storeRefKeys = diagram.storeRefs.map(s => `${s.kind}:${s.name}`).sort();

  // Use resolved kind:name pairs, not raw authored strings, so spelling variants
  // that resolve identically (e.g. bare "Shopper" vs "ext:Shopper") hash the same.
  const edgePairs = diagram.edges
    .map(e => `${e.from.kind}:${e.from.name}>${e.to.kind}:${e.to.name}`)
    .sort();

  const canonical =
    processIds.join(',') + '|' +
    externalIds.join(',') + '|' +
    storeRefKeys.join(',') + '|' +
    edgePairs.join(',');

  return fnv1a32(canonical);
}
