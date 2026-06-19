/**
 * test-zoom-scale.ts — unit tests for the DFD zoom/fit math (#3 viewer-ux-polish).
 *
 * Proves the native-1:1 zoom contract WITHOUT a browser:
 *   - computeFitScale: content larger than container → fit scale < 1;
 *     smaller → > 1; padding respected; degenerate (zero-size) guarded to 1.
 *   - screenScaleToPercent / percentToScreenScale round-trip: fit (internal
 *     scale 1) reports the real fitScale percent (NOT a forced 100); setPercent(100)
 *     resolves to the internal scale that yields native 1:1 on-screen.
 */

import {
  computeFitScale,
  screenScaleToPercent,
  percentToScreenScale,
} from '../../src/flow-view/zoom-scale';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// ── computeFitScale ────────────────────────────────────────────────────────

// Content larger than the container on both axes → must shrink to fit (< 1).
{
  const fit = computeFitScale({ w: 2000, h: 1500 }, { width: 800, height: 600 });
  assert(fit < 1, `large content → fit < 1 (got ${fit})`);
  // xMidYMid meet picks the smaller ratio: min(800/2000, 600/1500) = min(0.4, 0.4) = 0.4
  assert(approx(fit, 0.4), `square-aspect large content → 0.4 (got ${fit})`);
}
console.log('PASS: large content shrinks below 1');

// Content smaller than the container → fit > 1 (the small-model "180%" case).
{
  const fit = computeFitScale({ w: 200, h: 150 }, { width: 800, height: 600 });
  assert(fit > 1, `small content → fit > 1 (got ${fit})`);
  assert(approx(fit, 4), `200x150 in 800x600 → 4 (got ${fit})`);
}
console.log('PASS: small content grows above 1');

// Non-uniform aspect: the limiting (smaller) axis ratio wins (meet semantics).
{
  // wide content: width ratio 800/4000 = 0.2, height ratio 600/600 = 1 → 0.2
  const fit = computeFitScale({ w: 4000, h: 600 }, { width: 800, height: 600 });
  assert(approx(fit, 0.2), `wide content limited by width axis → 0.2 (got ${fit})`);
}
console.log('PASS: limiting axis (meet) wins');

// Padding respected: a larger content box (more padding) yields a smaller fit.
{
  const tight = computeFitScale({ w: 1000, h: 1000 }, { width: 800, height: 800 });
  const padded = computeFitScale({ w: 1200, h: 1200 }, { width: 800, height: 800 });
  assert(padded < tight, `more padding → smaller fit (tight ${tight}, padded ${padded})`);
}
console.log('PASS: padding respected');

// Degenerate dimensions guarded → 1 (never NaN / Infinity / divide-by-zero).
{
  assert(computeFitScale({ w: 0, h: 100 }, { width: 800, height: 600 }) === 1, 'zero content width → 1');
  assert(computeFitScale({ w: 100, h: 0 }, { width: 800, height: 600 }) === 1, 'zero content height → 1');
  assert(computeFitScale({ w: 100, h: 100 }, { width: 0, height: 600 }) === 1, 'zero container width → 1');
  assert(computeFitScale({ w: 100, h: 100 }, { width: 800, height: 0 }) === 1, 'zero container height → 1');
  assert(computeFitScale({ w: -100, h: 100 }, { width: 800, height: 600 }) === 1, 'negative content width → 1');
}
console.log('PASS: degenerate sizes guarded to 1');

// ── readout / setPercent semantics ──────────────────────────────────────────

// LARGE model: fit = 0.4. The initial view (internal scale 1 = fit) must report
// the TRUE percent 40 — NOT a forced 100.
{
  const fit = computeFitScale({ w: 2000, h: 1500 }, { width: 800, height: 600 }); // 0.4
  const fitPercent = screenScaleToPercent(1, fit);
  // True fit percent (40) — proves the readout is NOT forced to 100 on a large model.
  assert(fitPercent === 40, `large-model fit reports true 40% (got ${fitPercent})`);
}
console.log('PASS: large-model fit reports real sub-100% percent');

// SMALL model: fit = 4 → fit reports 400% (clamps may cap the live readout, but
// the math is unforced).
{
  const fit = computeFitScale({ w: 200, h: 150 }, { width: 800, height: 600 }); // 4
  const fitPercent = screenScaleToPercent(1, fit);
  assert(fitPercent === 400, `small-model fit reports true 400% (got ${fitPercent})`);
}
console.log('PASS: small-model fit reports real >100% percent');

// setPercent(100) → native 1:1: the internal scale must make on-screen ratio 1,
// and feeding it back through screenScaleToPercent must read exactly 100%.
{
  for (const fit of [0.4, 1, 1.8, 4, 0.123]) {
    const internal = percentToScreenScale(100, fit);
    assert(approx(internal, 1 / fit), `setPercent(100) → 1/fit for fit ${fit} (got ${internal})`);
    assert(screenScaleToPercent(internal, fit) === 100, `round-trip 100% for fit ${fit}`);
    // On-screen pixels-per-world-unit = internal * fit must be exactly 1 (native 1:1).
    assert(approx(internal * fit, 1), `native 1:1 at setPercent(100) for fit ${fit} (got ${internal * fit})`);
  }
}
console.log('PASS: setPercent(100) yields native 1:1 for any fitScale');

// Arbitrary percent round-trips through both helpers.
{
  const fit = 0.42;
  for (const pct of [50, 100, 150, 250]) {
    const internal = percentToScreenScale(pct, fit);
    assert(screenScaleToPercent(internal, fit) === pct, `round-trip ${pct}% for fit ${fit}`);
  }
}
console.log('PASS: percent round-trips');

// percentToScreenScale guards a degenerate fitScale (≤ 0) by treating it as 1.
{
  assert(percentToScreenScale(100, 0) === 1, 'fit 0 → treated as 1 at 100%');
  assert(percentToScreenScale(200, -5) === 2, 'negative fit → treated as 1');
}
console.log('PASS: percentToScreenScale guards degenerate fitScale');

console.log('ALL PASS: zoom-scale');
