/**
 * spotlight-lines.ts — pure separation geometry for the DD browse-lens spotlight overlay (CP6, #2).
 *
 * Pure module: no DOM, no React, no Bun/Node imports. Browser-safe and
 * unit-testable with plain coordinate literals. Same discipline as `spotlight.ts`.
 *
 * Problem it solves: `SpotlightOverlay` drew ONE bezier per connection and, for a
 * bidirectional (`both`) bundle, set BOTH `marker-start` and `marker-end` on that
 * single path — arrowheads at both ends of the same line. Parallel/overlapping
 * connections collapsed onto one line, so a relationship was lost behind another.
 *
 * This helper, given the base facing-edge anchor (from `computeAnchor`) and a list
 * of per-line directions, returns one line spec PER direction/edge, each carrying a
 * SINGLE direction and OFFSET connection points so neither the lines nor their
 * arrowheads coincide:
 *
 *  - The offset is perpendicular to the line axis. For a HORIZONTAL anchor (cards
 *    side by side) the endpoints' y is spread; for a VERTICAL anchor (cards stacked)
 *    the x is spread.
 *  - The spread is symmetric about the original midpoint: line i is offset by
 *    `(i - (K-1)/2) * GAP`, so the centre of mass stays on the base anchor.
 *  - A SINGLE edge (K === 1) is returned unchanged — no offset — preserving the
 *    common-case look exactly.
 *
 * The component calls `computeAnchor` (DOM measurement) then this pure helper, then
 * draws one `<path>` per returned spec. FK and flow (dashed) lines use the same
 * separation; only the direction set differs.
 */

export type LineDirection = 'out' | 'in';

export type BaseAnchor = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Whether the facing edges of the two cards meet horizontally or vertically. */
  anchor: 'horizontal' | 'vertical';
};

export type SpotlightLineSpec = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Exactly one direction → exactly one arrowhead (out → marker-end; in → marker-start). */
  direction: LineDirection;
};

/** Perpendicular spacing between adjacent separated lines, in CSS px. */
export const SPOTLIGHT_LINE_GAP = 14;

/**
 * Separate a bundle of edges into one offset line per direction.
 *
 * @param base       The facing-edge anchor for the active↔other card pair.
 * @param directions One entry per edge in the bundle (insertion order preserved).
 * @returns          One spec per direction. K === 1 → the base line, unchanged.
 *                   K === 0 → [].
 */
export function separateSpotlightLines(
  base: BaseAnchor,
  directions: readonly LineDirection[],
): SpotlightLineSpec[] {
  const count = directions.length;
  if (count === 0) return [];

  // Single edge: preserve today's look exactly — no offset.
  if (count === 1) {
    const direction = directions[0];
    if (direction === undefined) return [];
    return [{ x1: base.x1, y1: base.y1, x2: base.x2, y2: base.y2, direction }];
  }

  // Symmetric spread about the base midpoint: offset of line i is
  // (i - (count - 1) / 2) * GAP. Centre of mass stays on the base anchor.
  const half = (count - 1) / 2;

  return directions.map((direction, i) => {
    const offset = (i - half) * SPOTLIGHT_LINE_GAP;
    if (base.anchor === 'horizontal') {
      // Cards side by side: line axis is horizontal → spread y perpendicular.
      return {
        x1: base.x1,
        y1: base.y1 + offset,
        x2: base.x2,
        y2: base.y2 + offset,
        direction,
      };
    }
    // Vertical anchor — cards stacked: line axis is vertical → spread x perpendicular.
    return {
      x1: base.x1 + offset,
      y1: base.y1,
      x2: base.x2 + offset,
      y2: base.y2,
      direction,
    };
  });
}
