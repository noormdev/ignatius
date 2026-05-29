// Hash-router: pure parse + serialize for URL hash state.
// Format: #entity=<id>&zoom=<n>&pan=<x>,<y>
// All params are optional. Unknown/malformed values are silently dropped.

export interface HashState {
  entity?: string;
  zoom?: number;
  pan?: { x: number; y: number };
}

/**
 * Parse a URL hash string (e.g. "#entity=Party&zoom=1.5&pan=200,100") into
 * a HashState. The leading '#' is optional. Invalid numerics are dropped.
 */
export function parseHash(hash: string): HashState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};

  const params = new URLSearchParams(raw);
  const state: HashState = {};

  const entityVal = params.get('entity');
  if (entityVal !== null && entityVal.length > 0) {
    state.entity = entityVal;
  }

  const zoomVal = params.get('zoom');
  if (zoomVal !== null) {
    const n = Number(zoomVal);
    if (Number.isFinite(n)) state.zoom = n;
  }

  const panVal = params.get('pan');
  if (panVal !== null) {
    const parts = panVal.split(',');
    if (parts.length === 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        state.pan = { x, y };
      }
    }
  }

  return state;
}

/**
 * Serialize a HashState into a query string (without the leading '#').
 * Returns '' for an empty state. Built manually to keep pan=x,y human-readable
 * (URLSearchParams would percent-encode the comma to %2C).
 */
export function serializeHash(state: HashState): string {
  const parts: string[] = [];

  if (state.entity !== undefined) {
    // encodeURIComponent: entity ids may contain spaces or unicode; numbers don't need it.
    parts.push(`entity=${encodeURIComponent(state.entity)}`);
  }
  if (state.zoom !== undefined) {
    parts.push(`zoom=${state.zoom}`);
  }
  if (state.pan !== undefined) {
    // Pan is written as "x,y" (not via URLSearchParams) to keep the comma readable.
    // Numbers are URL-safe; no encoding needed.
    parts.push(`pan=${state.pan.x},${state.pan.y}`);
  }

  return parts.join('&');
}
