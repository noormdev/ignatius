/**
 * zoom-scale.ts — pure zoom/fit math for the DFD SVG viewer.
 *
 * No DOM, no React, no Bun/Node imports — browser-safe and unit-testable.
 * Same pure-module discipline as src/edge-routes.ts and src/app/logic/spotlight.ts.
 *
 * Zoom model (the #3 fix — viewer-ux-polish):
 * `100%` means native 1:1 — one diagram (world) unit renders as one CSS pixel,
 * independent of model size. The DFD `<svg>` keeps its viewBox = world content
 * box, so at the inner `<g>` transform's `scale === 1` the content is fit-to-
 * container, NOT 1:1. The on-screen pixels-per-world-unit therefore equals
 * `fitScale × internalScale`, where `fitScale` is the viewBox→container ratio
 * under the default `preserveAspectRatio="xMidYMid meet"` (= the smaller of the
 * two axis ratios). The readout reports that true on-screen ratio as a percent;
 * `fit` (internalScale === 1) reports `fitScale × 100` (e.g. ~42% on a large
 * model, ~180% on a small one), and native 1:1 is reached at
 * `internalScale = 1 / fitScale`.
 *
 * Keeping the viewBox = world box (rather than container pixels) means the
 * existing clientToWorld, pan, drag, and minimap viewport math are untouched —
 * only the scale↔percent mapping changes.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  /** content width in world units (already padded by the caller if desired) */
  w: number;
  /** content height in world units */
  h: number;
}

/**
 * The viewBox→container scale factor when an SVG viewBox of size `content`
 * (world units) is rendered into a container of `container` CSS pixels under the
 * default `preserveAspectRatio="xMidYMid meet"`: the content is uniformly scaled
 * to fit, so the factor is the smaller of the two axis ratios.
 *
 * This is also the on-screen pixels-per-world-unit when the inner transform's
 * scale is 1 — i.e. the true scale of the fit-to-screen view.
 *
 * Returns 1 for any degenerate (zero/negative) dimension so callers never divide
 * by zero or produce NaN.
 */
export function computeFitScale(content: Box, container: Size): number {
  const { w, h } = content;
  const { width, height } = container;
  if (w <= 0 || h <= 0 || width <= 0 || height <= 0) return 1;
  return Math.min(width / w, height / h);
}

/**
 * Convert the inner transform's `internalScale` to the true on-screen zoom
 * percent. `fitScale` is the result of computeFitScale for the current diagram +
 * container. Rounded to an integer percent for the readout.
 */
export function screenScaleToPercent(internalScale: number, fitScale: number): number {
  return Math.round(internalScale * fitScale * 100);
}

/**
 * Inverse of screenScaleToPercent: the inner transform's `internalScale` needed
 * to render the diagram at `pct`% true on-screen zoom. `setPercent(100)` → the
 * scale that yields native 1:1 (`1 / fitScale`).
 *
 * Guards a degenerate `fitScale` (≤ 0) by treating it as 1.
 */
export function percentToScreenScale(pct: number, fitScale: number): number {
  const f = fitScale > 0 ? fitScale : 1;
  return (pct / 100) / f;
}
