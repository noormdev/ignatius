import type cytoscape from 'cytoscape';
import type { ThemeConfig, ThemeMode } from '../../../theme/theme-defaults';
import { CHANGE_COLORS, REMOVED_RED } from '../../dom/theme-css-vars';
import { blendHex } from '../../logic/color';
import { GLOW_BLUR, GLOW_SPREAD } from '../../logic/change-marks';
import { animationsAllowed } from '../../logic/motion';

// One full pulse, matching the flow glow's 1.8s alternate keyframes.
const GLOW_PERIOD_MS = 3600;
// The floor stays well above zero so any single frame, a screenshot included, shows the mark.
const GLOW_MIN = 0.35;
const GLOW_MAX = 0.75;
/** The glow drawn when it does not pulse. */
export const GLOW_STEADY = (GLOW_MIN + GLOW_MAX) / 2;
/** Edge glows run the length of the line, so they draw weaker than node glows. */
export const EDGE_GLOW_SCALE = 0.6;
/** How far a steady unexplained glow leans from its kind color toward red. */
export const UNEXPLAINED_STEADY_MIX = 0.75;
// The shape is filled this far off-canvas and its shadow thrown back into view, so only the blur lands.
const SHADOW_THROW = 10_000;
/** Shared by styles.ts and the glow loop, so a glow dims with its node. */
export const TIER_OPACITY = { 'faded': 0.2, 'inherited-dim': 0.5, 'search-dim': 0.2 };
const BADGE_RADIUS = 8;
const BADGE_RADIUS_MIN = 6;
const BADGE_RADIUS_MAX = 14;

function tierOpacity(node: cytoscape.NodeSingular): number {
  return Math.min(1, ...Object.entries(TIER_OPACITY).filter(([tier]) => node.hasClass(tier)).map(([, opacity]) => opacity));
}

function sizeToViewport(canvas: HTMLCanvasElement, cy: cytoscape.Core, dpr: number): CanvasRenderingContext2D | null {
  const width = Math.round(cy.width() * dpr);
  const height = Math.round(cy.height() * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cy.width()}px`;
    canvas.style.height = `${cy.height()}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx?.clearRect(0, 0, cy.width(), cy.height());
  return ctx;
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number): void {
  const arm = radius * 0.4;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = REMOVED_RED;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = radius * 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
}

export interface GlowColors {
  added: string;
  changed: string;
  removed: string;
  unexplained: string;
}

export function glowColors(theme: ThemeConfig, mode: ThemeMode): GlowColors {
  const p = mode === 'light' ? theme.light : theme.dark;
  return { ...CHANGE_COLORS[mode], removed: p.textMuted };
}

function kindColor(colors: GlowColors, change: string): string {
  if (change === 'added') return colors.added;
  if (change === 'changed') return colors.changed;
  return colors.removed;
}

export interface ChangeGlow {
  /** Re-read the marked elements and start or stop the pulse to match. */
  refresh(): void;
  /** Stop the pulse and remove the glow and badge canvases. */
  destroy(): void;
}

/** Cytoscape has no blur style, so node glows go on a canvas behind it; ghost badges go above, clear of ghost opacity. */
export function createChangeGlow(cy: cytoscape.Core, container: HTMLElement, colors: () => GlowColors): ChangeGlow {
  const overlay = (name: string) => {
    const canvas = document.createElement('canvas');
    canvas.dataset.ignatius = name;
    Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    return canvas;
  };
  const canvas = overlay('change-glow');
  const badgeCanvas = overlay('change-badge');
  container.style.position = 'relative';
  container.insertBefore(canvas, container.firstChild);
  container.appendChild(badgeCanvas);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let nodes = cy.collection();
  let edges = cy.collection();
  let frameId: number | null = null;
  let startedAt = 0;
  let canvasesClear = false;

  function drawNodes(pulse: number, unexplainedMix: number): void {
    if (canvasesClear && nodes.empty()) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = sizeToViewport(canvas, cy, dpr);
    const badgeCtx = sizeToViewport(badgeCanvas, cy, dpr);
    if (!ctx || !badgeCtx) return;

    const zoom = cy.zoom();
    const viewWidth = cy.width();
    const viewHeight = cy.height();
    const palette = colors();
    const spread = GLOW_SPREAD * zoom;
    const badgeRadius = Math.min(BADGE_RADIUS_MAX, Math.max(BADGE_RADIUS_MIN, BADGE_RADIUS * zoom));
    // A canvas shadow blur fades out within three standard deviations, and shadowBlur is two of them.
    const reach = spread + 3 * GLOW_BLUR * zoom + badgeRadius;
    const drawn: Record<string, { alpha: number; color: string; badge?: number }> = {};
    ctx.shadowBlur = 2 * GLOW_BLUR * zoom * dpr;
    ctx.shadowOffsetX = SHADOW_THROW * dpr;
    nodes.forEach((node) => {
      if (node.removed() || !node.visible()) return;
      const { x, y } = node.renderedPosition();
      const outerWidth = node.renderedOuterWidth();
      const outerHeight = node.renderedOuterHeight();
      const left = x - outerWidth / 2;
      const top = y - outerHeight / 2;
      if (left + outerWidth + reach < 0 || left - reach > viewWidth || top + outerHeight + reach < 0 || top - reach > viewHeight) return;

      const kind = kindColor(palette, node.data('change'));
      const color = node.data('unexplained') === 'true' ? blendHex(kind, palette.unexplained, unexplainedMix) : kind;
      const alpha = pulse * node.effectiveOpacity();
      const rounded = node.style('shape') !== 'rectangle';
      ctx.save();
      // Keeps the glow outside the node, so translucent ghosts and dimmed nodes take no tint.
      ctx.beginPath();
      ctx.rect(0, 0, viewWidth, viewHeight);
      ctx.roundRect(left, top, outerWidth, outerHeight, rounded ? Math.min(outerWidth / 4, outerHeight / 4, 8 * zoom) : 0);
      ctx.clip('evenodd');
      ctx.globalAlpha = alpha;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.roundRect(left - spread - SHADOW_THROW, top - spread, outerWidth + spread * 2, outerHeight + spread * 2, rounded ? spread + 4 * zoom : 0);
      ctx.fill();
      ctx.restore();

      const badge = node.data('change') === 'removed' ? tierOpacity(node) : undefined;
      if (badge !== undefined) drawBadge(badgeCtx, left + outerWidth, top, badgeRadius, badge);
      drawn[node.id()] = { alpha, color, badge };
    });
    canvasesClear = Object.keys(drawn).length === 0;
    window.__IGNATIUS_GLOW__ = drawn;
  }

  function frame(now: number): void {
    const t = (now - startedAt) / GLOW_PERIOD_MS;
    const pulse = GLOW_MIN + (GLOW_MAX - GLOW_MIN) * (1 - Math.cos(2 * Math.PI * t)) / 2;
    const redShare = (1 - Math.cos(Math.PI * (t - 0.5))) / 2;
    const palette = colors();
    cy.batch(() => {
      edges.forEach((edge) => {
        if (edge.removed()) return;
        // Cytoscape draws an underlay at its own opacity, not the element's.
        const opacity = pulse * edge.effectiveOpacity() * EDGE_GLOW_SCALE;
        if (edge.data('unexplained') === 'true') {
          const color = blendHex(kindColor(palette, edge.data('change')), palette.unexplained, redShare);
          edge.style({ 'underlay-opacity': opacity, 'underlay-color': color });
        } else {
          edge.style('underlay-opacity', opacity);
        }
      });
    });
    drawNodes(pulse, redShare);
    frameId = requestAnimationFrame(frame);
  }

  function drawSteady(): void {
    if (frameId === null) drawNodes(GLOW_STEADY, UNEXPLAINED_STEADY_MIX);
  }

  function stopPulse(): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    cy.batch(() => edges.filter(el => !el.removed()).removeStyle('underlay-opacity underlay-color'));
  }

  function refresh(): void {
    stopPulse();
    nodes = cy.nodes('[change]');
    edges = cy.edges('[change]');
    const pulsing = (nodes.nonempty() || edges.nonempty()) && !reducedMotion.matches && animationsAllowed(cy.elements().length);
    if (!pulsing) {
      drawSteady();
      return;
    }
    startedAt = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  cy.on('render', drawSteady);
  reducedMotion.addEventListener('change', refresh);

  function destroy(): void {
    stopPulse();
    cy.off('render', drawSteady);
    reducedMotion.removeEventListener('change', refresh);
    canvas.remove();
    badgeCanvas.remove();
    window.__IGNATIUS_GLOW__ = undefined;
  }

  return { refresh, destroy };
}
