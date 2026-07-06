import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
import fcose from 'cytoscape-fcose';

// @ts-expect-error — cytoscape uses `export =` which loses namespace members under bundler resolution
cytoscape.use(elk);
cytoscape.use(fcose);

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
export function fanSubtypeClusters(cy: cytoscape.Core, maxExternalDegree = 4) {
  cy.nodes('[joiner = "true"]').forEach((j) => {
    const allMembers = cy.edges().filter((e) => e.source().id() === j.id()).map((e) => e.target());
    if (allMembers.length === 0) return;
    const inEdge = cy.edges().filter((e) => e.target().id() === j.id())[0];
    const base = inEdge ? inEdge.source() : null;

    // Put the joiner diamond ON the line between the basetype and its members'
    // centroid, so the base→joiner→member connector runs straight instead of
    // zig-zagging out to wherever the force layout happened to drop the joiner.
    const mcx = allMembers.reduce((s, m) => s + m.position().x, 0) / allMembers.length;
    const mcy = allMembers.reduce((s, m) => s + m.position().y, 0) / allMembers.length;
    const bp0 = base ? base.position() : { x: mcx, y: mcy };
    j.position({ x: bp0.x + (mcx - bp0.x) * 0.5, y: bp0.y + (mcy - bp0.y) * 0.5 });
    const jp = j.position();

    // Only fan leaf-like members. A subtype that is itself a hub (e.g. `individual`
    // with a dozen FK dependents) must stay where the force layout placed it —
    // snapping it onto the fan arc drags its whole neighbourhood outward, casting
    // the dependents off into their own island. Its own edges keep it cohesive.
    const members = allMembers.filter((m) => m.degree(false) - m.edgesWith(j).length <= maxExternalDegree);
    if (members.length === 0) return;
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
  // Hoist dimension reads out of the pair loops: on a rendered core each
  // outerWidth()/outerHeight() call re-measures the label bounding box, which
  // turns this O(n²·iters) loop into seconds of label measurement. Dimensions
  // are constant for the duration of the pass — read them once.
  const boxes = cy.nodes()
    .filter((n) => !n.isParent())
    .map((n) => ({ n, w: n.outerWidth(), h: n.outerHeight() }));
  const pad = 30;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const [a, A] of boxes.entries()) {
      for (const B of boxes.slice(a + 1)) {
        const pa = A.n.position();
        const pb = B.n.position();
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const minX = (A.w + B.w) / 2 + pad;
        const minY = (A.h + B.h) / 2 + pad;
        if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);
          if (overlapX < overlapY) {
            const shift = ((dx < 0 ? -1 : 1) * overlapX) / 2;
            A.n.position({ x: pa.x - shift, y: pa.y });
            B.n.position({ x: pb.x + shift, y: pb.y });
          } else {
            const shift = ((dy < 0 ? -1 : 1) * overlapY) / 2;
            A.n.position({ x: pa.x, y: pa.y - shift });
            B.n.position({ x: pb.x, y: pb.y + shift });
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

// Count pairwise crossings between rendered edges, treating each edge as the
// straight segment between its endpoints' centres. Edges sharing an endpoint
// never count — they meet at the node by construction. This is the fitness
// score for the multi-seed layout search: force sims have no force that
// "sees" a crossing, so the only way to fewer crossings is to try several
// deterministic seeds and keep the least-tangled result.
export function countEdgeCrossings(cy: cytoscape.Core): number {
  type Seg = { ax: number; ay: number; bx: number; by: number; s: string; t: string };
  const segs: Seg[] = [];
  cy.edges().forEach((e) => {
    const s = e.source(), t = e.target();
    if (s.isParent() || t.isParent()) return;
    const a = s.position(), b = t.position();
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, s: s.id(), t: t.id() });
  });
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  let count = 0;
  for (const [i, A] of segs.entries()) {
    for (const B of segs.slice(i + 1)) {
      if (A.s === B.s || A.s === B.t || A.t === B.s || A.t === B.t) continue;
      const o1 = orient(A.ax, A.ay, A.bx, A.by, B.ax, B.ay);
      const o2 = orient(A.ax, A.ay, A.bx, A.by, B.bx, B.by);
      const o3 = orient(B.ax, B.ay, B.bx, B.by, A.ax, A.ay);
      const o4 = orient(B.ax, B.ay, B.bx, B.by, A.bx, A.by);
      if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) count++;
    }
  }
  return count;
}

// Sum over groups of the average member-to-centroid distance, normalised by
// the candidate's mean edge length so the number is scale-free. This is the
// second fitness term of the multi-seed search: crossings alone would happily
// pick a low-crossing candidate that scatters a colour family across the
// canvas — group cohesion has to be part of what "best" means.
export function groupScatter(cy: cytoscape.Core): number {
  const byGroup = new Map<string, { x: number; y: number }[]>();
  cy.nodes(':childless').forEach((n) => {
    const g = n.data('group');
    if (!g || n.data('joiner') === 'true') return;
    const p = n.position();
    const pts = byGroup.get(g);
    if (pts) pts.push({ x: p.x, y: p.y }); else byGroup.set(g, [{ x: p.x, y: p.y }]);
  });
  let edgeLenSum = 0, edgeCount = 0;
  cy.edges().forEach((e) => {
    const a = e.source().position(), b = e.target().position();
    edgeLenSum += Math.hypot(b.x - a.x, b.y - a.y);
    edgeCount++;
  });
  const unit = edgeCount > 0 ? edgeLenSum / edgeCount : 1;
  if (unit === 0) return 0;
  let total = 0;
  byGroup.forEach((pts) => {
    if (pts.length < 2) return;
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cyy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    total += pts.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cyy), 0) / pts.length / unit;
  });
  return total;
}

// Ephemeral same-group attraction edges for the fCoSE run. The model's group
// (the border colour) is a semantic cluster the force sim knows nothing about,
// so groupmates with no direct FK drift apart. A star of soft springs from
// each group's best-connected member to every groupmate pulls the colour
// family into one neighbourhood. The edges exist ONLY inside the synchronous
// layout run: GraphView adds them before creating the layout (cytoscape
// snapshots the element set at cy.layout() time) and arrangeOrganic strips
// them first thing, so the degree-based local passes and the renderer never
// see them. Deterministic: anchor = highest degree, ties by id.
export const GROUP_PULL_SELECTOR = 'edge[groupPull = "true"]';

export function addGroupPullEdges(cy: cytoscape.Core) {
  const byGroup = new Map<string, cytoscape.NodeSingular[]>();
  cy.nodes(':childless').forEach((n) => {
    const g = n.data('group');
    if (!g || n.data('joiner') === 'true') return;
    const members = byGroup.get(g);
    if (members) members.push(n); else byGroup.set(g, [n]);
  });
  const defs: cytoscape.ElementDefinition[] = [];
  byGroup.forEach((members, g) => {
    if (members.length < 2) return;
    const anchor = members.reduce((best, n) => {
      const d = n.degree(false), bd = best.degree(false);
      return d > bd || (d === bd && n.id() < best.id()) ? n : best;
    });
    for (const m of members) {
      if (m === anchor) continue;
      // edgeLabel: '' — the edge stylesheet maps `label: data(edgeLabel)`;
      // without the field cytoscape logs a mapping warning PER EDGE PER STYLE
      // RECALC, which floods the console during the multi-candidate search.
      defs.push({ group: 'edges', data: { id: `_gpull_${g}_${m.id()}`, source: anchor.id(), target: m.id(), groupPull: 'true', edgeLabel: '' } });
    }
  });
  cy.add(defs);
}

// Inflate the core skeleton about its centroid while carrying each hub's
// degree-1 satellites along rigidly. The force sim finds its cleanest global
// organization at compact spring lengths, but that solution packs the dense
// mid-band (real-model feedback: boxes crowded, labels colliding). A uniform
// scale of the CORE is a similarity transform — it cannot introduce a single
// new edge crossing — while satellites keep their tight local rings, so the
// result reads as "same picture, more room" rather than a re-layout.
export function expandCore(cy: cytoscape.Core, factor = 1.3) {
  const plain = cy.nodes().filter((n) => !n.isParent());
  const isSatellite = (n: cytoscape.NodeSingular) =>
    n.parent().empty() && n.data('joiner') !== 'true' && n.degree(false) === 1
    && n.openNeighborhood().nodes()[0].degree(false) > 1; // 2-node islands scale as core
  const satellites = plain.filter(isSatellite);
  const core = plain.difference(satellites);
  if (core.length < 2) return;
  let cx = 0, cy0 = 0;
  core.forEach((n) => { cx += n.position().x; cy0 += n.position().y; });
  cx /= core.length; cy0 /= core.length;
  // Record every satellite's offset from its hub before the hubs move.
  const rides = satellites.map((s) => {
    const hub = s.openNeighborhood().nodes()[0];
    const sp = s.position(), hp = hub.position();
    return { s, hub, dx: sp.x - hp.x, dy: sp.y - hp.y };
  });
  core.forEach((n) => {
    const p = n.position();
    n.position({ x: cx + (p.x - cx) * factor, y: cy0 + (p.y - cy0) * factor });
  });
  rides.forEach(({ s, hub, dx, dy }) => {
    const hp = hub.position();
    s.position({ x: hp.x + dx, y: hp.y + dy });
  });
}

// Pull each degree-1 satellite in toward its hub when the force layout left it
// stranded. Classifier/type leaves must read as satellites of their entity —
// a far-flung leaf turns into a long dashed edge slicing across the graph, the
// dominant clutter on real models. Pure radial move (angle kept): the ring
// radius is size-aware and grows with satellite count so a many-leaf hub (e.g.
// `source` with ~9 type boxes) still has arc room for every box. separateLeafFan
// then spreads crowded satellites angularly; deoverlapNodes clears collisions.
export function dockLeaves(cy: cytoscape.Core) {
  const movable = (n: cytoscape.NodeSingular) => n.parent().empty() && n.data('joiner') !== 'true';
  cy.nodes().forEach((hub) => {
    if (hub.isParent() || hub.data('joiner') === 'true') return;
    const leaves = hub.openNeighborhood().nodes().filter((nb) => nb.degree(false) === 1 && movable(nb));
    if (leaves.length === 0) return;
    const hp = hub.position();
    const hubExtent = Math.max(hub.outerWidth(), hub.outerHeight()) / 2;
    // Each satellite box needs ~130px of arc on roughly three-quarters of the
    // ring (the remaining quarter faces the hub's real edges).
    const maxDist = Math.max(150, hubExtent + (leaves.length * 130) / (2 * Math.PI * 0.75));
    leaves.forEach((leaf) => {
      const p = leaf.position();
      const dx = p.x - hp.x, dy = p.y - hp.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= maxDist || dist < 1) return;
      leaf.position({ x: hp.x + (dx / dist) * maxDist, y: hp.y + (dy / dist) * maxDist });
    });
  });
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

// Nudge a node off any edge that passes through its box but does not connect to
// it, so lines stop cutting through unrelated entities. For each node, find the
// non-incident edge whose segment runs closest to the node centre; if that line
// pierces the box (perpendicular gap under the box's half-extent, and the foot
// of the perpendicular falls within the segment), shove the node perpendicular
// until it clears. Iterative and convergent like deoverlapNodes — it stops once
// a pass moves nothing. Skips compound parents and the joiner diamonds.
export function separateNodesFromEdges(cy: cytoscape.Core, iterations: number) {
  const pad = 14;
  // Dimensions hoisted out of the loops — see deoverlapNodes for why.
  const boxes = cy.nodes()
    .filter((n) => !n.isParent() && n.data('joiner') !== 'true')
    .map((n) => ({ n, halfW: n.outerWidth() / 2 + pad, halfH: n.outerHeight() / 2 + pad }));
  const edges = cy.edges().filter((e) => !e.source().isParent() && !e.target().isParent());
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const { n, halfW, halfH } of boxes) {
      const p = n.position();
      for (const e of edges) {
        const s = e.source(), t = e.target();
        if (s.id() === n.id() || t.id() === n.id()) continue; // incident — its own edge
        const a = s.position(), b = t.position();
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1) continue;
        const proj = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
        if (proj < 0.05 || proj > 0.95) continue; // foot outside the segment
        const footx = a.x + proj * abx, footy = a.y + proj * aby;
        const perpx = p.x - footx, perpy = p.y - footy;
        const perpDist = Math.hypot(perpx, perpy);
        // Clearance scales the box half-extent by the edge's orientation, so a
        // near-horizontal line is judged against the box height, vertical against width.
        const len = Math.sqrt(len2);
        const clearance = (halfW * Math.abs(aby) + halfH * Math.abs(abx)) / len;
        if (perpDist >= clearance) continue;
        const ux = perpDist > 1 ? perpx / perpDist : -aby / len;
        const uy = perpDist > 1 ? perpy / perpDist : abx / len;
        const shove = clearance - perpDist;
        n.position({ x: p.x + ux * shove, y: p.y + uy * shove });
        moved = true;
        break; // re-evaluate this node against all edges next pass
      }
    }
    if (!moved) break;
  }
}

// Post-process a settled organic (fCoSE) layout: fan subtype clusters into tidy
// rings, pull interleaved fans into distinct regions, dock far-flung satellites
// back onto their hub's ring, spread hub satellites angularly, triangulate
// collinear pass-throughs, push nodes off edges that cut through them, then
// clear residual node overlaps.
//
// iters — iteration budget per pass (derived from node count via ORGANIC_ITERS_*).
// Below the first threshold (<50 nodes) callers pass ORGANIC_ITERS_TINY, which
// restores the original hardcoded 80/90 values and preserves full visual quality.
export function arrangeOrganic(cy: cytoscape.Core, iters: OrganicIters) {
  // The group-pull springs did their job during the force run; strip them
  // before any degree-based local pass (docking, fans) can misread them as
  // real relationships — and before anything could paint them.
  cy.remove(GROUP_PULL_SELECTOR);
  expandCore(cy);
  fanSubtypeClusters(cy);
  separateClusterFans(cy, iters.clusterFan);
  dockLeaves(cy);
  separateLeafFan(cy, iters.leafFan);
  decollinearNodes(cy);
  separateNodesFromEdges(cy, iters.deoverlap);
  deoverlapNodes(cy, iters.deoverlap);
}

// Build a HEADLESS scratch mirror of the live graph for the layout search.
// Once the live core has painted, every element read and write pays renderer
// bookkeeping — label re-measures, compound-bounds upkeep, listener notify —
// measured at SECONDS per search candidate versus milliseconds headless. The
// search therefore runs entirely on this mirror and only the winning
// positions touch the live core. Node dimensions are baked in as data
// (dw/dh from the live outerWidth/outerHeight, read once — a cheap, paint-
// independent measurement) so scratch geometry matches the live boxes without
// any label machinery; the `layout-uniform` class gives the global fCoSE
// passes their fixed structure-only box.
export function buildScratchCore(live: cytoscape.Core): cytoscape.Core {
  const elements: cytoscape.ElementDefinition[] = [];
  live.nodes().forEach((n) => {
    const data = { ...n.data() };
    if (!n.isParent()) {
      data.dw = n.outerWidth();
      data.dh = n.outerHeight();
    }
    elements.push({ group: 'nodes', data });
  });
  live.edges().forEach((e) => {
    elements.push({ group: 'edges', data: { ...e.data() } });
  });
  return cytoscape({
    headless: true,
    styleEnabled: true,
    elements,
    style: [
      { selector: 'node[dw]', style: { 'width': 'data(dw)', 'height': 'data(dh)' } },
      { selector: 'node.layout-uniform', style: { 'width': 60, 'height': 36 } },
    ],
  });
}

// Derive the iteration budget for arrangeOrganic from entity count.
// Returns ORGANIC_ITERS_TINY for n < 50 (original full-quality settings).
export function organicIters(n: number): OrganicIters {
  if (n < 50)  return ORGANIC_ITERS_TINY;
  if (n < 100) return ORGANIC_ITERS_SMALL;
  return ORGANIC_ITERS_MEDIUM;
}
