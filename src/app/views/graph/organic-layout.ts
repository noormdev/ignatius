import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';

// @ts-expect-error — cytoscape uses `export =` which loses namespace members under bundler resolution
cytoscape.use(elk);

// ── ELK cost-scaling thresholds ───────────────────────────────────────────────
// These constants gate both layered-thoroughness and organic post-processing.
// Scaling is always by model.nodes.length (entity count, not cy leaf count).
//
// ORGANIC_FALLBACK_THRESHOLD: above this count, organic mode falls back to
// cheap layered even when the user chose "organic". ELK stress is O(n²) per
// iteration and cannot render 150+ nodes without crashing the tab.
//
// LAYERED_THOROUGHNESS_*: passed directly to ELK `elk.layered.thoroughness`.
// Fewer iterations → faster layout; below 50 we keep the original high quality.
//
// ORGANIC_ITERS_*: iteration counts for arrangeOrganic post-processing passes.
// `clusterFan` = separateClusterFans; `leafFan` = separateLeafFan; `deoverlap` = deoverlapNodes.
// Below 50 nodes all three run at full quality (original hardcoded values).
export const ORGANIC_FALLBACK_THRESHOLD = 150; // at or above this count → fall back to cheap layered instead of stress

export const LAYERED_THOROUGHNESS_TINY    = 30;  // n < 50
export const LAYERED_THOROUGHNESS_SMALL   = 20;  // 50 ≤ n < 100
export const LAYERED_THOROUGHNESS_MEDIUM  = 14;  // 100 ≤ n < 200
export const LAYERED_THOROUGHNESS_LARGE   = 7;   // n ≥ 200

// Organic post-processing pass counts per tier.
// Full quality (original): clusterFan=80, leafFan=80, deoverlap=90.
export type OrganicIters = { clusterFan: number; leafFan: number; deoverlap: number };
export const ORGANIC_ITERS_TINY:   OrganicIters = { clusterFan: 80, leafFan: 80, deoverlap: 90 };  // n < 50
export const ORGANIC_ITERS_SMALL:  OrganicIters = { clusterFan: 40, leafFan: 40, deoverlap: 45 };  // 50 ≤ n < 100
export const ORGANIC_ITERS_MEDIUM: OrganicIters = { clusterFan: 20, leafFan: 20, deoverlap: 22 };  // 100 ≤ n < FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

// Place each subtype cluster's members on an arc around their joiner diamond,
// fanning away from the basetype. Keeps basetype/subtype clusters cohesive under
// the organic (stress) layout, which otherwise treats identifying joiner→member
// edges like any other and flings members across the canvas.
//
// Size-aware: neighbour spacing clears the largest member's footprint, so
// multi-line boxes and many-member clusters never collide on the arc. The span
// widens with member count — small clusters stay a tight fan, large ones wrap
// toward a near-full ring (capped just under 2π so the base side stays open).
export function fanSubtypeClusters(cy: cytoscape.Core) {
  cy.nodes('[joiner = "true"]').forEach((j) => {
    const jp = j.position();
    const members = cy.edges().filter((e) => e.source().id() === j.id()).map((e) => e.target());
    if (members.length === 0) return;
    const inEdge = cy.edges().filter((e) => e.target().id() === j.id())[0];
    const base = inEdge ? inEdge.source() : null;
    // Fan outward, away from the basetype, so the diamond sits between base and members.
    let baseAngle = Math.PI / 2;
    if (base) {
      const bp = base.position();
      baseAngle = Math.atan2(jp.y - bp.y, jp.x - bp.x);
    }
    const n = members.length;
    const slot = Math.max(...members.map((m) => Math.max(m.outerWidth(), m.outerHeight()))) + 26;
    const span = Math.min(2 * Math.PI * (n / (n + 1)), 0.9 + n * 0.42);
    const gap = span / Math.max(1, n - 1);
    // Radius so the chord between neighbours clears a slot: chord = 2R·sin(gap/2).
    const radius = Math.max(120, slot / 2 / Math.sin(Math.min(Math.PI / 2, gap / 2) || 1));
    members.forEach((m, i) => {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const angle = baseAngle + t * span;
      m.position({ x: jp.x + radius * Math.cos(angle), y: jp.y + radius * Math.sin(angle) });
    });
  });
}

// Light separating-axis pass to clear residual node overlaps left when two
// nearby clusters' fans land on top of each other. Nudges only overlapping pairs
// apart along their axis of least penetration; converges fast (breaks once a
// pass moves nothing). Skips compound parents (invisible cluster boxes).
export function deoverlapNodes(cy: cytoscape.Core, iterations: number) {
  const nodes = cy.nodes().filter((n) => !n.isParent());
  const pad = 30;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const A = nodes[a];
        const B = nodes[b];
        const pa = A.position();
        const pb = B.position();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const minX = (A.outerWidth() + B.outerWidth()) / 2 + pad;
        const minY = (A.outerHeight() + B.outerHeight()) / 2 + pad;
        if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);
          if (overlapX < overlapY) {
            const shift = ((dx < 0 ? -1 : 1) * overlapX) / 2;
            A.position({ x: pa.x - shift, y: pa.y });
            B.position({ x: pb.x + shift, y: pb.y });
          } else {
            const shift = ((dy < 0 ? -1 : 1) * overlapY) / 2;
            A.position({ x: pa.x, y: pa.y - shift });
            B.position({ x: pb.x, y: pb.y + shift });
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Push whole subtype-cluster fans (joiner + members) apart so interleaved
// clusters settle into distinct regions, not merely un-overlapped. Works on each
// fan's bounding box; the per-node de-overlap that follows cleans up the
// node-level collisions a coarse shove can introduce.
export function separateClusterFans(cy: cytoscape.Core, iterations: number) {
  const fans = cy.nodes('[joiner = "true"]').map((j) => j.outgoers('node').union(j)).filter((fan) => fan.length > 1);
  if (fans.length < 2) return;
  const margin = 45;
  const shiftFan = (fan, dx: number, dy: number) =>
    fan.forEach((n) => { const p = n.position(); n.position({ x: p.x + dx, y: p.y + dy }); });
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let a = 0; a < fans.length; a++) {
      for (let b = a + 1; b < fans.length; b++) {
        const ba = fans[a].boundingBox();
        const bb = fans[b].boundingBox();
        const overlapX = Math.min(ba.x2, bb.x2) - Math.max(ba.x1, bb.x1) + margin;
        const overlapY = Math.min(ba.y2, bb.y2) - Math.max(ba.y1, bb.y1) + margin;
        if (overlapX > 0 && overlapY > 0) {
          const aLeftOfB = ba.x1 + ba.x2 < bb.x1 + bb.x2;
          const aAboveB = ba.y1 + ba.y2 < bb.y1 + bb.y2;
          // Separate along the axis of least penetration (smaller move).
          if (overlapX < overlapY) {
            const s = overlapX / 2;
            shiftFan(fans[a], aLeftOfB ? -s : s, 0);
            shiftFan(fans[b], aLeftOfB ? s : -s, 0);
          } else {
            const s = overlapY / 2;
            shiftFan(fans[a], 0, aAboveB ? -s : s);
            shiftFan(fans[b], 0, aAboveB ? s : -s);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Spread a hub's degree-1 satellites angularly so their edges stop smearing into
// one line. Each leaf is repelled — in angle, around its hub — by every other
// neighbour edge until it clears a minimum gap; distance from the hub is kept,
// so this is a pure rotation that never changes how far a leaf sits.
export function separateLeafFan(cy: cytoscape.Core, iterations: number) {
  const minGap = 0.42;
  const step = 0.5;
  const movable = (n) => n.parent().empty() && n.data('joiner') !== 'true';
  const isLeaf = (n) => n.degree(false) === 1 && movable(n);
  for (let it = 0; it < iterations; it++) {
    cy.nodes().forEach((h) => {
      if (!movable(h)) return;
      const nbrs = h.openNeighborhood().nodes();
      if (nbrs.length < 2) return;
      const hp = h.position();
      const entries = nbrs.map((nb) => ({ nb, ang: Math.atan2(nb.position().y - hp.y, nb.position().x - hp.x), leaf: isLeaf(nb) }));
      entries.forEach((e) => {
        if (!e.leaf) return;
        let push = 0;
        entries.forEach((o) => {
          if (o === e) return;
          let d = e.ang - o.ang;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) < minGap) push += (d >= 0 ? 1 : -1) * (minGap - Math.abs(d));
        });
        if (push !== 0) {
          const p = e.nb.position();
          const dist = Math.hypot(p.x - hp.x, p.y - hp.y);
          const a = e.ang + push * step;
          e.nb.position({ x: hp.x + dist * Math.cos(a), y: hp.y + dist * Math.sin(a) });
        }
      });
    });
  }
}

// Triangulate a degree-2 pass-through node that sits on the line between its two
// neighbours: nudge it perpendicular off the line so its two edges stop
// overlapping into one. Only fires when the node is between the neighbours
// (projection within the segment) and closer to the line than the clearance.
export function decollinearNodes(cy: cytoscape.Core) {
  const clearance = 80;
  cy.nodes().forEach((n) => {
    if (n.data('joiner') === 'true' || !n.parent().empty() || n.degree(false) !== 2) return;
    const nb = n.openNeighborhood().nodes();
    if (nb.length !== 2) return;
    const A = nb[0].position(), B = nb[1].position(), P = n.position();
    const abx = B.x - A.x, aby = B.y - A.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1) return;
    const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2;
    if (t < 0.15 || t > 0.85) return;
    const projx = A.x + t * abx, projy = A.y + t * aby;
    const perpx = P.x - projx, perpy = P.y - projy;
    const perpDist = Math.hypot(perpx, perpy);
    if (perpDist >= clearance) return;
    const len = Math.sqrt(len2);
    const ux = perpDist > 1 ? perpx / perpDist : -aby / len;
    const uy = perpDist > 1 ? perpy / perpDist : abx / len;
    n.position({ x: projx + ux * clearance, y: projy + uy * clearance });
  });
}

// Post-process a settled organic (stress) layout: fan subtype clusters into tidy
// rings, pull interleaved fans into distinct regions, spread hub satellites,
// triangulate collinear pass-throughs, then clear residual node overlaps.
//
// iters — iteration budget per pass (derived from node count via ORGANIC_ITERS_*).
// Below the first threshold (<50 nodes) callers pass ORGANIC_ITERS_TINY, which
// restores the original hardcoded 80/90 values and preserves full visual quality.
export function arrangeOrganic(cy: cytoscape.Core, iters: OrganicIters) {
  fanSubtypeClusters(cy);
  separateClusterFans(cy, iters.clusterFan);
  separateLeafFan(cy, iters.leafFan);
  decollinearNodes(cy);
  deoverlapNodes(cy, iters.deoverlap);
}

// Derive the iteration budget for arrangeOrganic from entity count.
// Returns ORGANIC_ITERS_TINY for n < 50 (original full-quality settings).
export function organicIters(n: number): OrganicIters {
  if (n < 50)  return ORGANIC_ITERS_TINY;
  if (n < 100) return ORGANIC_ITERS_SMALL;
  return ORGANIC_ITERS_MEDIUM;
}
