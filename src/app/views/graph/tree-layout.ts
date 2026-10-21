import type { PositionMap } from './layout-store';
import { orderRegions } from './grouped-layered';

// Outline layout with lane-separated right-angled lines: see
// docs/design/graph-tree-layout.md.

export type TreeNodeInput = {
  id: string;
  width: number;
  height: number;
  group: string;
  classifier: boolean;
  /** A subtype joiner diamond: never wraps away from its basetype. */
  joiner?: boolean;
};
/** `source` is the referenced (parent) table, `target` the table holding the FK. */
export type TreeEdgeInput = { id: string; source: string; target: string; identifying: boolean; label: string };

export type Forest = {
  parent: Map<string, string>;
  children: Map<string, string[]>;
  roots: string[];
  /** Tables nothing hangs under that a table references, each with the consumer whose tree they sit above. */
  lookups: Map<string, string>;
};

/** A node's centre and size. */
export type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/** The line a route draws now: its two ends, the bends between, and where its label goes. */
export type RouteGeometry = {
  kind: 'down' | 'cross';
  parentEnd: Point;
  bends: Point[];
  childEnd: Point;
  /** `down` only: label distance from the child end, halfway along the run into it. */
  labelOffset: number;
};

/** Lane (from the parent's right edge, negative), street (below the parent's bottom) and approach column (from the child's left edge, negative). */
export type CrossSlot = { laneDx: number; streetDy: number; approachDx: number };

/** A line to route: tree lines (`down`) as the last tree layout drew them, everything else `cross`. */
export type TreeLine = { id: string; parent: string; child: string; kind: 'down' | 'cross' };

/** Where a line runs from its parent's bottom edge into its child's left side, relative to both so it survives a drag. */
export type TreeRoute = {
  kind: 'down' | 'cross';
  parent: string;
  child: string;
  /** `down` only: lane x from the parent's left edge. */
  laneDx: number;
  /** The cross geometry: a `cross` route's own; for a `down` route, the fallback while a drag moves its child out of place. */
  slot: CrossSlot;
  /** Row the line enters the child at, from the child's centre. */
  entryDy: number;
};

// Rows leave room for a cross link's street and its centred label under a parent.
const ROW_GAP = 20;
const TREE_GAP = 40;
const COLUMN_GAP = 80;
const LANE_GAP = 6;
const STREET_INSET = 10;
const STREET_GAP = 2;
const STREET_BAND = 6;
const APPROACH_INSET = 12;
const LANE_INSET = 10;
const ENTRY_GAP = 6;
const LABEL_CHAR_WIDTH = 6;
const LABEL_PAD = 14;
const MIN_RUN = 28;
const ASPECT = 16 / 10;
const HUB_MIN_REFERENCES = 8;
const HUB_SHARE = 0.1;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildForest(nodes: TreeNodeInput[], edges: TreeEdgeInput[]): Forest {
  const info = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map<string, TreeEdgeInput[]>();
  const outgoing = new Map<string, TreeEdgeInput[]>();
  for (const e of edges) {
    if (e.source === e.target || !info.has(e.source) || !info.has(e.target)) continue;
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  // A table many others reference without inheriting its key (users behind
  // every `created_by`) would gather every unrelated table under itself.
  const referencedBy = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.identifying || e.source === e.target) continue;
    referencedBy.set(e.source, (referencedBy.get(e.source) ?? new Set()).add(e.target));
  }
  const hubLimit = Math.max(HUB_MIN_REFERENCES, Math.ceil(nodes.length * HUB_SHARE));
  const isHub = (id: string) => (referencedBy.get(id)?.size ?? 0) >= hubLimit;

  // Key inheritance first; without it, an FK parent that is neither a classifier nor a hub.
  const candidates = (id: string): string[] => {
    const into = incoming.get(id) ?? [];
    const identifying = into.filter(e => e.identifying).map(e => e.source);
    if (identifying.length > 0) return [...new Set(identifying)];
    return [...new Set(into.filter(e => !info.get(e.source)?.classifier && !isHub(e.source)).map(e => e.source))];
  };

  // Longest candidate chain above a node, so a table hangs under its most specific parent.
  const rank = new Map<string, number>();
  const onPath = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (onPath.has(id)) return 0;
    onPath.add(id);
    const above = candidates(id).map(rankOf);
    onPath.delete(id);
    const r = above.length === 0 ? 0 : 1 + Math.max(...above);
    rank.set(id, r);
    return r;
  };

  const parent = new Map<string, string>();
  const viaKey = new Set<string>();
  for (const n of [...nodes].sort((a, b) => byId(a.id, b.id))) {
    const options = candidates(n.id).sort((a, b) => rankOf(b) - rankOf(a) || byId(a, b));
    const chosen = options[0];
    if (chosen === undefined) continue;
    parent.set(n.id, chosen);
    if ((incoming.get(n.id) ?? []).some(e => e.identifying && e.source === chosen)) viaKey.add(n.id);
  }

  // Break any cycle at a plain FK link (smallest id first); only a cycle made
  // entirely of key links is cut at a key link.
  for (const n of nodes) {
    const seen: string[] = [];
    let at: string | undefined = n.id;
    while (at !== undefined && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at);
    }
    if (at !== undefined) {
      const cycle = seen.slice(seen.indexOf(at)).sort(byId);
      const breakAt = cycle.find(id => !viaKey.has(id)) ?? cycle[0];
      if (breakAt !== undefined) parent.delete(breakAt);
    }
  }

  const childCount = new Map<string, number>();
  for (const p of parent.values()) childCount.set(p, (childCount.get(p) ?? 0) + 1);

  // A root nothing hangs under is a lookup: never hung under a table that uses
  // it, where its line would run from parent back to child.
  const isLoose = (id: string) => !parent.has(id) && (childCount.get(id) ?? 0) === 0 && !isHub(id)
    && (outgoing.get(id)?.length ?? 0) > 0;
  const lookups = new Map<string, string>();
  for (const n of [...nodes].sort((a, b) => byId(a.id, b.id))) {
    if (!isLoose(n.id)) continue;
    // A lookup used only by other lookups has no tree to sit above; it stays a root.
    const consumers = [...new Set((outgoing.get(n.id) ?? []).map(e => e.target))]
      .filter(c => !isLoose(c))
      .sort((a, b) => Number(info.get(b)?.group === n.group) - Number(info.get(a)?.group === n.group) || byId(a, b));
    const host = consumers[0];
    if (host !== undefined) lookups.set(n.id, host);
  }

  const children = new Map<string, string[]>();
  for (const [child, p] of parent) children.set(p, [...(children.get(p) ?? []), child]);
  const roots = nodes.map(n => n.id).filter(id => !parent.has(id) && !lookups.has(id));
  return { parent, children, roots, lookups };
}

// Each placed node (lookups included) mapped to the root of the tree it belongs to.
function treeRoots(roots: string[], children: Map<string, string[]>, lookups: Map<string, string>): Map<string, string> {
  const rootOf = new Map<string, string>();
  const claim = (id: string, root: string) => {
    rootOf.set(id, root);
    for (const kid of children.get(id) ?? []) claim(kid, root);
  };
  for (const root of roots) claim(root, root);
  for (const [lookup, consumer] of lookups) {
    const root = rootOf.get(consumer);
    if (root !== undefined) rootOf.set(lookup, root);
  }
  return rootOf;
}

// Lanes fan across half a bottom edge, stopping 2 px short of the centre so the
// halves never meet; a half with no room past the inset is one trunk at the centre.
function fan(halfWidth: number, count: number, gap: number): { base: number; gap: number } {
  const roomy = halfWidth - LANE_INSET - 2;
  if (roomy <= 0) return { base: halfWidth, gap: 0 };
  return { base: LANE_INSET, gap: count <= 1 ? 0 : Math.min(gap, roomy / (count - 1)) };
}

const NO_SLOT: CrossSlot = { laneDx: -LANE_INSET, streetDy: STREET_INSET, approachDx: -APPROACH_INSET };

export function layoutTree(nodes: TreeNodeInput[], edges: TreeEdgeInput[]): { positions: PositionMap; routes: Map<string, TreeRoute> } {
  const info = new Map(nodes.map(n => [n.id, n]));
  const forest = buildForest(nodes, edges);
  const { children, roots } = forest;

  const sizeMemo = new Map<string, number>();
  const subtreeSize = (id: string): number => {
    const known = sizeMemo.get(id);
    if (known !== undefined) return known;
    const size = 1 + (children.get(id) ?? []).reduce((sum, c) => sum + subtreeSize(c), 0);
    sizeMemo.set(id, size);
    return size;
  };
  // Smaller subtrees first: the lanes that run furthest down pass fewer rows.
  const orderedChildren = (id: string) =>
    [...(children.get(id) ?? [])].sort((a, b) => subtreeSize(a) - subtreeSize(b) || byId(a, b));
  const heightMemo = new Map<string, number>();
  const stackHeight = (id: string): number => {
    const known = heightMemo.get(id);
    if (known !== undefined) return known;
    const kids = children.get(id) ?? [];
    const height = (info.get(id)?.height ?? 0) + kids.reduce((sum, c) => sum + ROW_GAP + stackHeight(c), 0);
    heightMemo.set(id, height);
    return height;
  };

  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const byPair = new Map<string, TreeEdgeInput[]>();
  for (const e of [...edges].sort((a, b) => byId(a.id, b.id))) {
    const key = pairKey(e.source, e.target);
    byPair.set(key, [...(byPair.get(key) ?? []), e]);
  }
  const edgesBetween = (p: string, c: string) => byPair.get(pairKey(p, c)) ?? [];
  const labelRun = (list: TreeEdgeInput[]) =>
    Math.max(MIN_RUN, Math.max(0, ...list.map(e => e.label.length * LABEL_CHAR_WIDTH)) + 2 * LABEL_PAD);

  let positions: PositionMap = {};
  let routes = new Map<string, TreeRoute>();

  const inWrap = new Set<string>();
  let wrapDepth = 0;
  const isJoiner = (id: string) => info.get(id)?.joiner === true;

  // Lays the subtree out with its top-left at (left, top); returns its bottom and right.
  // Children that would run past `limit` wrap into columns to the right.
  const place = (id: string, left: number, top: number, limit: number): { bottom: number; right: number } => {
    const self = info.get(id);
    if (!self) return { bottom: top, right: left };
    positions[id] = { x: left + self.width / 2, y: top + self.height / 2 };
    if (wrapDepth > 0) inWrap.add(id);
    let bottom = top + self.height;
    let right = left + self.width;

    const firstRow = bottom + ROW_GAP;
    const kids = orderedChildren(id);
    // A fresh column must fit two of the parent's child rows, or wrapping makes a strip of one-table columns.
    const childRow = Math.max(0, ...kids.map(k => info.get(k)?.height ?? 0)) + ROW_GAP;
    const canWrap = limit - firstRow >= 2 * childRow;
    const overflows = canWrap && top + stackHeight(id) > limit;
    // When children wrap, a subtype cluster goes first so it gets the room under its basetype.
    const order = overflows ? [...kids.filter(isJoiner), ...kids.filter(k => !isJoiner(k))] : kids;
    const kept: string[] = [];
    const wrapped: string[] = [];
    let used = firstRow;
    for (const kid of order) {
      const height = stackHeight(kid);
      if (kept.length === 0 || isJoiner(kid) || !canWrap || used + height <= limit) {
        kept.push(kid);
        used += height + ROW_GAP;
      } else {
        wrapped.push(kid);
      }
    }
    if (kept.length === 0) return { bottom, right };

    const kidEdges = kept.map(k => edgesBetween(id, k));
    const laneCount = kidEdges.reduce((sum, list) => sum + list.length, 0);
    // Tree lanes use the left half of the parent's bottom edge; cross links the right.
    const { base: laneBase, gap: laneGap } = fan(self.width / 2, laneCount, LANE_GAP);
    const childLeft = left + laneBase + (laneCount - 1) * laneGap + labelRun(kidEdges.flat());

    // The first child's lanes are rightmost, so each lower child's lane runs
    // left of every earlier child's horizontal and never crosses it.
    let lane = laneCount - 1;
    let rowTop = firstRow;
    kept.forEach((kid, i) => {
      const placed = place(kid, childLeft, rowTop, limit);
      for (const edge of kidEdges[i] ?? []) {
        const laneDx = laneBase + lane * laneGap;
        routes.set(edge.id, { kind: 'down', parent: id, child: kid, laneDx, slot: NO_SLOT, entryDy: 0 });
        lane--;
      }
      rowTop = placed.bottom + ROW_GAP;
      bottom = placed.bottom;
      right = Math.max(right, placed.right);
    });

    // Wrapped columns start at the first child row, so their cross links still run down and right.
    let columnLeft = right + COLUMN_GAP;
    let columnRight = columnLeft;
    let inColumn = 0;
    rowTop = firstRow;
    for (const kid of wrapped) {
      if (inColumn > 0 && rowTop + stackHeight(kid) > limit) {
        columnLeft = columnRight + COLUMN_GAP;
        rowTop = firstRow;
        inColumn = 0;
      }
      wrapDepth++;
      const placed = place(kid, columnLeft, rowTop, limit);
      wrapDepth--;
      columnRight = Math.max(columnRight, placed.right);
      rowTop = placed.bottom + ROW_GAP;
      inColumn++;
      bottom = Math.max(bottom, placed.bottom);
      right = Math.max(right, placed.right);
    }
    return { bottom, right };
  };

  const feedsOf = new Map<string, TreeEdgeInput[]>();
  for (const e of [...edges].sort((a, b) => byId(a.id, b.id))) {
    if (forest.lookups.has(e.source) && e.source !== e.target) {
      feedsOf.set(e.source, [...(feedsOf.get(e.source) ?? []), e]);
    }
  }

  // A tree's lookups sit in a staircase above it, the one feeding the deepest
  // table top-left, so a lookup's run into its deepest table crosses no other lookup's lane.
  const placeBlock = (root: string): { members: string[]; width: number; height: number } => {
    const before = new Set(Object.keys(positions));
    const tree = place(root, 0, 0, columnHeight);
    const members = Object.keys(positions).filter(id => !before.has(id));
    const inTree = new Set(members);
    // A lookup joins the block of its assigned consumer only; its lines into other trees are cross links.
    const blockLookups = [...forest.lookups].filter(([, consumer]) => inTree.has(consumer)).map(([l]) => l);
    if (blockLookups.length === 0) return { members, width: tree.right, height: tree.bottom };

    // A run into a wrapped table would pass behind the boxes on its row; that line is a cross link.
    const feedsFor = (l: string) => (feedsOf.get(l) ?? []).filter(e => inTree.has(e.target) && !inWrap.has(e.target))
      .sort((a, b) => (positions[b.target]?.y ?? 0) - (positions[a.target]?.y ?? 0) || byId(a.id, b.id));
    const deepest = (l: string) => positions[feedsFor(l)[0]?.target ?? '']?.y ?? 0;
    const stair = [...blockLookups].sort((a, b) => deepest(b) - deepest(a) || byId(a, b));

    let stepLeft = 0;
    let stepTop = 0;
    let bandRight = 0;
    const lanes: { edge: TreeEdgeInput; lookup: string; laneDx: number; x: number }[] = [];
    for (const l of stair) {
      const self = info.get(l);
      const width = self?.width ?? 0;
      const height = self?.height ?? 0;
      positions[l] = { x: stepLeft + width / 2, y: stepTop + height / 2 };
      const own = feedsFor(l);
      const spread = fan(width / 2, own.length, LANE_GAP);
      own.forEach((edge, k) => {
        const laneDx = spread.base + k * spread.gap;
        lanes.push({ edge, lookup: l, laneDx, x: stepLeft + laneDx });
      });
      bandRight = Math.max(bandRight, stepLeft + width);
      // The next lookup starts right of these lanes, so they drop past it.
      stepLeft += spread.base + Math.max(0, own.length - 1) * spread.gap + LANE_INSET;
      stepTop += height + ROW_GAP;
    }

    const lastLane = Math.max(0, ...lanes.map(l => l.x));
    const treeLeft = lastLane + labelRun(lanes.map(l => l.edge));
    const treeTop = stepTop;
    for (const id of members) {
      const p = positions[id];
      if (p) positions[id] = { x: p.x + treeLeft, y: p.y + treeTop };
    }
    for (const { edge, lookup, laneDx } of lanes) {
      routes.set(edge.id, { kind: 'down', parent: lookup, child: edge.target, laneDx, slot: NO_SLOT, entryDy: 0 });
    }
    return {
      members: [...members, ...stair],
      width: Math.max(bandRight, treeLeft + tree.right),
      height: treeTop + tree.bottom,
    };
  };

  const measure = (root: string) => {
    const saved = { positions, routes };
    positions = {};
    routes = new Map();
    const size = place(root, 0, 0, Infinity);
    ({ positions, routes } = saved);
    return { width: size.right, height: size.bottom };
  };

  // Columns about as tall as makes the whole picture ~16:10; a tree's lookup
  // band adds to its height.
  const rootOf = treeRoots(roots, children, forest.lookups);
  const bandHeight = new Map<string, number>();
  for (const lookup of forest.lookups.keys()) {
    const root = rootOf.get(lookup);
    if (root !== undefined) bandHeight.set(root, (bandHeight.get(root) ?? 0) + (info.get(lookup)?.height ?? 0) + ROW_GAP);
  }
  const area = roots.reduce((sum, r) => {
    const { width, height } = measure(r);
    return sum + (width + COLUMN_GAP) * (height + (bandHeight.get(r) ?? 0) + TREE_GAP);
  }, 0);
  const columnHeight = Math.sqrt(area / ASPECT);

  // A tree other trees reference goes first (left, or above in its column), so
  // links between trees run right and down: colour groups, then trees in each.
  const groupOf = (root: string) => info.get(root)?.group ?? '';
  const treeLinks = edges.flatMap((e) => {
    const source = rootOf.get(e.source);
    const target = rootOf.get(e.target);
    return source !== undefined && target !== undefined && source !== target ? [{ source, target }] : [];
  });
  const groupOrder = orderRegions(
    [...new Set(roots.map(groupOf))],
    treeLinks.map(l => ({ source: groupOf(l.source), target: groupOf(l.target) })),
  );
  const ordered = groupOrder.flatMap((g) => {
    const inGroup = roots.filter(r => groupOf(r) === g);
    return orderRegions(inGroup, treeLinks.filter(l => groupOf(l.source) === g && groupOf(l.target) === g));
  });

  const trees = ordered.map(root => placeBlock(root));

  let columnLeft = 0;
  let columnWidth = 0;
  let y = 0;
  for (const tree of trees) {
    if (y > 0 && y + tree.height > columnHeight) {
      columnLeft += columnWidth + COLUMN_GAP;
      columnWidth = 0;
      y = 0;
    }
    for (const id of tree.members) {
      const p = positions[id];
      if (p) positions[id] = { x: p.x + columnLeft, y: p.y + y };
    }
    y += tree.height + TREE_GAP;
    columnWidth = Math.max(columnWidth, tree.width);
  }

  const lines: TreeLine[] = [...routes].map(([id, r]) => ({ id, parent: r.parent, child: r.child, kind: 'down' }));
  for (const e of edges) {
    if (routes.has(e.id) || e.source === e.target || !positions[e.source] || !positions[e.target]) continue;
    lines.push({ id: e.id, parent: e.source, child: e.target, kind: 'cross' });
  }
  return { positions, routes: routeTree(nodes, positions, lines) };
}

/** Lanes, slots, entry rows and approach columns for `lines` at `positions`; a tree line whose
 *  child is no longer below its parent and right of its lane is routed as a cross link. */
export function routeTree(nodes: TreeNodeInput[], positions: PositionMap, lines: TreeLine[]): Map<string, TreeRoute> {
  const info = new Map(nodes.map(n => [n.id, n]));
  const left = (id: string) => (positions[id]?.x ?? 0) - (info.get(id)?.width ?? 0) / 2;
  const top = (id: string) => (positions[id]?.y ?? 0) - (info.get(id)?.height ?? 0) / 2;
  const bottom = (id: string) => (positions[id]?.y ?? 0) + (info.get(id)?.height ?? 0) / 2;
  const placed = lines
    .filter(l => l.parent !== l.child && positions[l.parent] && positions[l.child] && info.has(l.parent) && info.has(l.child))
    .sort((a, b) => byId(a.id, b.id));

  const routes = new Map<string, TreeRoute>();
  const downsByParent = new Map<string, TreeLine[]>();
  for (const l of placed) {
    if (l.kind === 'down' && top(l.child) > bottom(l.parent)) {
      downsByParent.set(l.parent, [...(downsByParent.get(l.parent) ?? []), l]);
    }
  }
  for (const [parent, all] of downsByParent) {
    // The topmost child takes the rightmost lane; a child left of its lane leaves the fan.
    let list = [...all].sort((a, b) => (positions[a.child]?.y ?? 0) - (positions[b.child]?.y ?? 0) || byId(a.id, b.id));
    const laneDx = (i: number, count: number) => {
      const spread = fan((info.get(parent)?.width ?? 0) / 2, count, LANE_GAP);
      return spread.base + (count - 1 - i) * spread.gap;
    };
    for (;;) {
      const fits = list.filter((l, i) => left(l.child) > left(parent) + laneDx(i, list.length) + 2);
      if (fits.length === list.length) break;
      list = fits;
    }
    list.forEach((l, i) => {
      routes.set(l.id, { kind: 'down', parent, child: l.child, laneDx: laneDx(i, list.length), slot: NO_SLOT, entryDy: 0 });
    });
  }
  for (const l of placed) {
    if (!routes.has(l.id)) routes.set(l.id, { kind: 'cross', parent: l.parent, child: l.child, laneDx: 0, slot: NO_SLOT, entryDy: 0 });
  }
  crossSlots(info, positions, routes);
  assignEntries(info, positions, routes);
  return routes;
}

// Each cross link from a parent gets its own lane and street, the farthest child
// the outer lane and top street: nearer children right and below nest inside.
function crossSlots(info: Map<string, TreeNodeInput>, positions: PositionMap, routes: Map<string, TreeRoute>): void {
  const x = (id: string) => positions[id]?.x ?? 0;
  const byParent = new Map<string, [string, TreeRoute][]>();
  for (const [id, route] of routes) {
    if (route.kind === 'cross') byParent.set(route.parent, [...(byParent.get(route.parent) ?? []), [id, route]]);
  }
  for (const [parent, list] of byParent) {
    list.sort(([ia, a], [ib, b]) => Math.abs(x(b.child) - x(parent)) - Math.abs(x(a.child) - x(parent)) || byId(ia, ib));
    const spread = fan((info.get(parent)?.width ?? 0) / 2, list.length, LANE_GAP);
    const streetGap = list.length <= 1 ? 0 : Math.min(STREET_GAP, STREET_BAND / (list.length - 1));
    list.forEach(([, route], k) => {
      route.slot = { laneDx: -(spread.base + k * spread.gap), streetDy: STREET_INSET + k * streetGap, approachDx: -APPROACH_INSET };
    });
  }
}

// Entry rows and approach columns share one order so no last turns cross:
// see docs/design/graph-tree-layout.md, Drawing the lines.
function assignEntries(info: Map<string, TreeNodeInput>, positions: PositionMap, routes: Map<string, TreeRoute>): void {
  const into = new Map<string, [string, TreeRoute][]>();
  for (const [id, route] of routes) into.set(route.child, [...(into.get(route.child) ?? []), [id, route]]);
  for (const [child, entries] of into) {
    const childY = positions[child]?.y ?? 0;
    const height = info.get(child)?.height ?? 0;
    const parentLeft = (route: TreeRoute) => (positions[route.parent]?.x ?? 0) - (info.get(route.parent)?.width ?? 0) / 2;
    const streetY = (route: TreeRoute) =>
      (positions[route.parent]?.y ?? 0) + (info.get(route.parent)?.height ?? 0) / 2 + route.slot.streetDy;
    const group = (route: TreeRoute) => (route.kind === 'down' ? 1 : streetY(route) < childY ? 0 : 2);
    const key = (route: TreeRoute) => (route.kind === 'down' ? -(parentLeft(route) + route.laneDx) : streetY(route));
    entries.sort(([ia, a], [ib, b]) => group(a) - group(b) || key(a) - key(b) || byId(ia, ib));
    const list = entries.map(([, route]) => route);
    const gap = list.length <= 1 ? 0 : Math.min(ENTRY_GAP, Math.max(0, height - 8) / (list.length - 1));
    list.forEach((route, k) => { route.entryDy = (k - (list.length - 1) / 2) * gap; });

    const fromAbove = list.filter(r => group(r) === 0);
    const fromBelow = list.filter(r => group(r) === 2);
    const column = (i: number) => -(APPROACH_INSET + i * LANE_GAP);
    fromAbove.forEach((route, i) => { route.slot = { ...route.slot, approachDx: column(i) }; });
    // From below after from above, so the two groups never share a column.
    fromBelow.forEach((route, i) => { route.slot = { ...route.slot, approachDx: column(fromAbove.length + fromBelow.length - 1 - i) }; });
  }
}

// A `down` route whose child no longer sits below and right of its lane (after
// a hide, reveal, reload or drag) is drawn with cross geometry instead.
export function routeGeometry(route: TreeRoute, parent: Box, child: Box): RouteGeometry {
  const parentBottom = parent.y + parent.height / 2;
  const childLeft = child.x - child.width / 2;
  const entryY = child.y + route.entryDy;
  const childEnd = { x: childLeft, y: entryY };
  if (route.kind === 'down') {
    const laneX = parent.x - parent.width / 2 + route.laneDx;
    if (entryY > parentBottom + 2 && childLeft > laneX + 2) {
      return {
        kind: 'down',
        parentEnd: { x: laneX, y: parentBottom },
        bends: [{ x: laneX, y: entryY }],
        childEnd,
        labelOffset: (childLeft - laneX) / 2,
      };
    }
  }
  const laneX = parent.x + parent.width / 2 + route.slot.laneDx;
  const streetY = parentBottom + route.slot.streetDy;
  const approachX = childLeft + route.slot.approachDx;
  return {
    kind: 'cross',
    parentEnd: { x: laneX, y: parentBottom },
    // The first bend twice: an even bend count puts cytoscape's mid label on
    // the street, between the two central bends.
    bends: [{ x: laneX, y: streetY }, { x: laneX, y: streetY }, { x: approachX, y: streetY }, { x: approachX, y: entryY }],
    childEnd,
    labelOffset: 0,
  };
}
