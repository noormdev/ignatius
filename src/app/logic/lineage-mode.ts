/**
 * lineage-mode.ts — reads the `?lineage=` escape hatch off the URL.
 *
 * Impure by design (touches `location`), which is why it is NOT in
 * `spotlight-inherited.ts` — that module stays browser-agnostic and
 * unit-testable. This is a comparison switch, not a product setting: it is read
 * once per call and applies on reload. There is deliberately no UI for it.
 *
 *   ?lineage=legacy  → walk through junction entities (the original rule)
 *   anything else    → 'strict' (junctions are barriers)
 */

import type { LineageMode } from './spotlight-inherited';

export function getLineageMode(): LineageMode {
  if (typeof location === 'undefined') return 'strict';
  return new URLSearchParams(location.search).get('lineage') === 'legacy'
    ? 'legacy'
    : 'strict';
}
