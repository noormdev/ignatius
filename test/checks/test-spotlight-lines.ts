/**
 * test-spotlight-lines.ts — unit tests for separateSpotlightLines (CP6, #2).
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 *
 * The pure helper separates an overlapping/bidirectional spotlight bundle into
 * one drawn line per direction, with offset connection points perpendicular to
 * the line axis so neither the lines nor their arrowheads coincide. A single
 * edge stays as ONE line with no offset (preserving today's look).
 *
 * What this proves:
 *  - A `both` bundle (1 out + 1 in) → 2 specs with DISTINCT endpoints, one out, one in.
 *  - A multi-edge bundle (2 out) → 2 specs, distinct offsets, both out.
 *  - A single edge → 1 spec, NO offset (endpoints equal the base anchor).
 *  - Horizontal anchor offsets y; vertical anchor offsets x; spread symmetric
 *    about the base midpoint.
 *
 * A no-op helper that returns a single line for the `both` case fails the first test.
 */

import {
  separateSpotlightLines,
  type SpotlightLineSpec,
  type BaseAnchor,
} from '../../src/app/logic/spotlight-lines';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/** True when two specs share BOTH endpoint coordinates exactly. */
function sharesEndpoints(a: SpotlightLineSpec, b: SpotlightLineSpec): boolean {
  return (
    approx(a.x1, b.x1) && approx(a.y1, b.y1) && approx(a.x2, b.x2) && approx(a.y2, b.y2)
  );
}

// ---------------------------------------------------------------------------
// T1: `both` bundle (1 out + 1 in) → 2 specs, distinct endpoints, one out / one in.
// ---------------------------------------------------------------------------
{
  // Horizontal anchor: cards side by side, y1===y2 at the base.
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['out', 'in']);

  assert(specs.length === 2, 'T1: 2 line specs for a both bundle');

  const [a, b] = specs;
  assert(a !== undefined && b !== undefined, 'T1: both specs present');
  // No path shares the SAME endpoints as the other.
  assert(!sharesEndpoints(a, b), 'T1: the two specs have DISTINCT endpoints');
  // Each spec carries exactly one direction.
  const dirs = specs.map(s => s.direction).sort();
  assert(dirs[0] === 'in' && dirs[1] === 'out', 'T1: one out + one in (single direction each)');

  // No shared connection point at either end.
  assert(!(approx(a.x1, b.x1) && approx(a.y1, b.y1)), 'T1: near endpoints differ');
  assert(!(approx(a.x2, b.x2) && approx(a.y2, b.y2)), 'T1: far endpoints differ');

  console.log('PASS T1: both bundle → 2 distinct single-direction specs');
}

// ---------------------------------------------------------------------------
// T2: multi-edge bundle (2 out) → 2 specs, distinct offsets, both out.
// ---------------------------------------------------------------------------
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['out', 'out']);

  assert(specs.length === 2, 'T2: 2 line specs for a 2-edge bundle');
  const [a, b] = specs;
  assert(a !== undefined && b !== undefined, 'T2: both specs present');
  assert(!sharesEndpoints(a, b), 'T2: distinct offsets');
  assert(a.direction === 'out' && b.direction === 'out', 'T2: both out');
  console.log('PASS T2: multi-edge bundle → 2 distinct specs');
}

// ---------------------------------------------------------------------------
// T3: single edge → 1 spec, NO offset (endpoints equal the base anchor).
// ---------------------------------------------------------------------------
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['out']);

  assert(specs.length === 1, 'T3: exactly 1 spec for a single edge');
  const only = specs[0];
  assert(only !== undefined, 'T3: spec present');
  assert(approx(only.x1, base.x1), 'T3: x1 unchanged');
  assert(approx(only.y1, base.y1), 'T3: y1 unchanged (no offset)');
  assert(approx(only.x2, base.x2), 'T3: x2 unchanged');
  assert(approx(only.y2, base.y2), 'T3: y2 unchanged (no offset)');
  assert(only.direction === 'out', 'T3: direction preserved');
  console.log('PASS T3: single edge → 1 unchanged spec (no offset)');
}

// Single 'in' edge — also unchanged, direction preserved.
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['in']);
  assert(specs.length === 1, 'T3b: 1 spec');
  const only = specs[0];
  assert(only !== undefined, 'T3b: spec present');
  assert(
    approx(only.x1, base.x1) && approx(only.y1, base.y1) &&
      approx(only.x2, base.x2) && approx(only.y2, base.y2),
    'T3b: endpoints unchanged',
  );
  assert(only.direction === 'in', 'T3b: direction in preserved');
  console.log('PASS T3b: single in edge → 1 unchanged spec');
}

// ---------------------------------------------------------------------------
// T4: HORIZONTAL anchor offsets y (x endpoints unchanged); spread symmetric.
// ---------------------------------------------------------------------------
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['out', 'in']);
  assert(specs.length === 2, 'T4: 2 specs');
  const [a, b] = specs;
  assert(a !== undefined && b !== undefined, 'T4: specs present');

  // Horizontal: x endpoints stay on the facing edges; only y is spread.
  assert(approx(a.x1, base.x1) && approx(b.x1, base.x1), 'T4: x1 stays on active facing edge');
  assert(approx(a.x2, base.x2) && approx(b.x2, base.x2), 'T4: x2 stays on other facing edge');

  // y endpoints are spread (differ from base midpoint y).
  assert(!approx(a.y1, base.y1) || !approx(b.y1, base.y1), 'T4: y1 is offset for at least one line');

  // Spread symmetric about the base midpoint y (== base.y1 here since y1===y2).
  const baseMidY = (base.y1 + base.y2) / 2;
  const avgY1 = (a.y1 + b.y1) / 2;
  const avgY2 = (a.y2 + b.y2) / 2;
  assert(approx(avgY1, baseMidY), 'T4: y1 offsets symmetric about base midpoint');
  assert(approx(avgY2, baseMidY), 'T4: y2 offsets symmetric about base midpoint');

  // The two lines are parallel-shifted: each line keeps its own y1===y2 (axis horizontal).
  assert(approx(a.y1, a.y2), 'T4: line a stays horizontal');
  assert(approx(b.y1, b.y2), 'T4: line b stays horizontal');
  console.log('PASS T4: horizontal anchor offsets y, symmetric about midpoint');
}

// ---------------------------------------------------------------------------
// T5: VERTICAL anchor offsets x (y endpoints unchanged); spread symmetric.
// ---------------------------------------------------------------------------
{
  // Vertical anchor: cards stacked, x1===x2 at the base.
  const base: BaseAnchor = { x1: 250, y1: 100, x2: 250, y2: 400, anchor: 'vertical' };
  const specs = separateSpotlightLines(base, ['out', 'in']);
  assert(specs.length === 2, 'T5: 2 specs');
  const [a, b] = specs;
  assert(a !== undefined && b !== undefined, 'T5: specs present');

  // Vertical: y endpoints stay on the facing edges; only x is spread.
  assert(approx(a.y1, base.y1) && approx(b.y1, base.y1), 'T5: y1 stays on active facing edge');
  assert(approx(a.y2, base.y2) && approx(b.y2, base.y2), 'T5: y2 stays on other facing edge');

  // x endpoints are spread.
  assert(!approx(a.x1, base.x1) || !approx(b.x1, base.x1), 'T5: x1 is offset for at least one line');

  // Spread symmetric about the base midpoint x (== base.x1 here since x1===x2).
  const baseMidX = (base.x1 + base.x2) / 2;
  const avgX1 = (a.x1 + b.x1) / 2;
  const avgX2 = (a.x2 + b.x2) / 2;
  assert(approx(avgX1, baseMidX), 'T5: x1 offsets symmetric about base midpoint');
  assert(approx(avgX2, baseMidX), 'T5: x2 offsets symmetric about base midpoint');

  // Each line keeps its own x1===x2 (axis vertical).
  assert(approx(a.x1, a.x2), 'T5: line a stays vertical');
  assert(approx(b.x1, b.x2), 'T5: line b stays vertical');
  console.log('PASS T5: vertical anchor offsets x, symmetric about midpoint');
}

// ---------------------------------------------------------------------------
// T6: empty directions → [] (no throw).
// ---------------------------------------------------------------------------
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, []);
  assert(Array.isArray(specs) && specs.length === 0, 'T6: empty directions → []');
  console.log('PASS T6: empty directions → []');
}

// ---------------------------------------------------------------------------
// T7: three edges → 3 distinct specs (mid line on the base axis, two flank it).
// ---------------------------------------------------------------------------
{
  const base: BaseAnchor = { x1: 100, y1: 200, x2: 400, y2: 200, anchor: 'horizontal' };
  const specs = separateSpotlightLines(base, ['out', 'out', 'in']);
  assert(specs.length === 3, 'T7: 3 specs');
  // All three pairwise distinct.
  assert(!sharesEndpoints(specs[0]!, specs[1]!), 'T7: spec 0 != 1');
  assert(!sharesEndpoints(specs[0]!, specs[2]!), 'T7: spec 0 != 2');
  assert(!sharesEndpoints(specs[1]!, specs[2]!), 'T7: spec 1 != 2');
  // Symmetric: average y of all near-endpoints == base midpoint y.
  const avgY1 = (specs[0]!.y1 + specs[1]!.y1 + specs[2]!.y1) / 3;
  assert(approx(avgY1, base.y1), 'T7: 3-line spread symmetric (avg == base midpoint)');
  console.log('PASS T7: three edges → 3 distinct symmetric specs');
}

console.log('\nAll tests passed.');
