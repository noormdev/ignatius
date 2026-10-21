import type { PositionMap } from './layout-store';
import { orderRegions } from './grouped-layered';

// Outline layout with right-angled lines, one trunk per parent: see
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
/** `source` is the referenced (parent) table, `target` the FK holder; runs are sized to fit `label`, its longest label. */
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
  /** `down`, or `cross` with `runLabel`: label distance from the child end, halfway along the run into it. */
  labelOffset: number;
};

/** Lane (from the parent's right edge, negative), street (below the parent's bottom) and approach column (from the child's left edge, negative). */
export type CrossSlot = {
  laneDx: number;
  streetDy: number;
  approachDx: number;
  /** When no straight drop clears the boxes: drop at `dropDx` from the child's left edge to `jogDy` from its centre, then across to the approach column. */
  jog?: { dropDx: number; jogDy: number };
};

/** A line to route: tree lines (`down`) as the last tree layout drew them, everything else `cross`. */
export type TreeLine = { id: string; parent: string; child: string; kind: 'down' | 'cross'; label?: string };

/** Where a line runs from its parent's bottom edge into its child's left side, relative to both so it survives a drag. */
export type TreeRoute = {
  kind: 'down' | 'cross';
  parent: string;
  child: string;
  /** `down` only: the trunk's x from the parent's left edge. */
  trunkDx: number;
  /** The cross geometry: a `cross` route's own; for a `down` route, the fallback while a drag moves its child out of place. */
  slot: CrossSlot;
  /** Row the line enters the child at, from the child's centre. */
  entryDy: number;
  /** `cross` only: the approach column sits far enough left that the label goes on the run into the child. */
  runLabel?: boolean;
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

// Cross-link lanes fan across the right half of a bottom edge, stopping 2 px short of the centre;
// a half with no room past the inset sends them all down from the centre.
function fan(halfWidth: number, count: number): { base: number; gap: number } {
  const roomy = halfWidth - LANE_INSET - 2;
  if (roomy <= 0) return { base: halfWidth, gap: 0 };
  return { base: LANE_INSET, gap: count <= 1 ? 0 : Math.min(LANE_GAP, roomy / (count - 1)) };
}

// A parent's tree lines share one trunk a quarter of the way in from its left edge.
function trunkOffset(width: number): number {
  return Math.max(Math.min(LANE_INSET, width / 2), Math.min(width / 4, width / 2 - 2));
}

/** The horizontal run a set of labels needs: the widest label plus padding. */
function labelRunOf(labels: string[]): number {
  return Math.max(MIN_RUN, Math.max(0, ...labels.map(l => l.length * LABEL_CHAR_WIDTH)) + 2 * LABEL_PAD);
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
  // Smaller subtrees first, so the largest hangs last, at the foot of the trunk.
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
  const labelRun = (list: TreeEdgeInput[]) => labelRunOf(list.map(e => e.label));
  const incoming = new Map<string, TreeEdgeInput[]>();
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  // A wrapped column sits far enough right of what it wraps past that every label into it fits its run.
  const wrapGap = (kids: string[]) =>
    Math.max(COLUMN_GAP, APPROACH_INSET + labelRun(kids.flatMap(k => incoming.get(k) ?? [])));

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
    const trunk = trunkOffset(self.width);
    const childLeft = left + trunk + labelRun(kidEdges.flat());

    let rowTop = firstRow;
    kept.forEach((kid, i) => {
      const placed = place(kid, childLeft, rowTop, limit);
      for (const edge of kidEdges[i] ?? []) {
        routes.set(edge.id, { kind: 'down', parent: id, child: kid, trunkDx: trunk, slot: NO_SLOT, entryDy: 0 });
      }
      rowTop = placed.bottom + ROW_GAP;
      bottom = placed.bottom;
      right = Math.max(right, placed.right);
    });

    // Wrapped columns start at the first child row, so their cross links still run down and right.
    const gap = wrapGap(wrapped);
    let columnLeft = right + gap;
    let columnRight = columnLeft;
    let inColumn = 0;
    rowTop = firstRow;
    for (const kid of wrapped) {
      if (inColumn > 0 && rowTop + stackHeight(kid) > limit) {
        columnLeft = columnRight + gap;
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
  // table top-left, so a lookup's run into its deepest table crosses no other lookup's trunk.
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
    const trunks: { edge: TreeEdgeInput; lookup: string; trunkDx: number; x: number }[] = [];
    for (const l of stair) {
      const self = info.get(l);
      const width = self?.width ?? 0;
      const height = self?.height ?? 0;
      positions[l] = { x: stepLeft + width / 2, y: stepTop + height / 2 };
      const trunk = trunkOffset(width);
      for (const edge of feedsFor(l)) trunks.push({ edge, lookup: l, trunkDx: trunk, x: stepLeft + trunk });
      bandRight = Math.max(bandRight, stepLeft + width);
      // The next lookup starts right of this trunk, so it drops past it.
      stepLeft += trunk + LANE_INSET;
      stepTop += height + ROW_GAP;
    }

    const lastTrunk = Math.max(0, ...trunks.map(l => l.x));
    const treeLeft = lastTrunk + labelRun(trunks.map(l => l.edge));
    const treeTop = stepTop;
    for (const id of members) {
      const p = positions[id];
      if (p) positions[id] = { x: p.x + treeLeft, y: p.y + treeTop };
    }
    for (const { edge, lookup, trunkDx } of trunks) {
      routes.set(edge.id, { kind: 'down', parent: lookup, child: edge.target, trunkDx, slot: NO_SLOT, entryDy: 0 });
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

  const labelOf = new Map(edges.map(e => [e.id, e.label]));
  const lines: TreeLine[] = [...routes].map(([id, r]) => ({ id, parent: r.parent, child: r.child, kind: 'down', label: labelOf.get(id) }));
  for (const e of edges) {
    if (routes.has(e.id) || e.source === e.target || !positions[e.source] || !positions[e.target]) continue;
    lines.push({ id: e.id, parent: e.source, child: e.target, kind: 'cross', label: e.label });
  }
  return { positions, routes: routeTree(nodes, positions, lines) };
}

/** Trunks, slots, entry rows and approach columns for `lines` at `positions`; a tree line whose
 *  child is no longer below its parent and right of its trunk is routed as a cross link. */
export function routeTree(nodes: TreeNodeInput[], positions: PositionMap, lines: TreeLine[]): Map<string, TreeRoute> {
  const info = new Map(nodes.map(n => [n.id, n]));
  const frame = frameOf(info, positions);
  const placed = lines
    .filter(l => l.parent !== l.child && positions[l.parent] && positions[l.child] && info.has(l.parent) && info.has(l.child))
    .sort((a, b) => byId(a.id, b.id));

  const routes = new Map<string, TreeRoute>();
  // A tree line keeps room right of its trunk for the columns of the child's other lines from above (any of
  // them may be routed as a cross link), which would cross it.
  const roomFor = (line: TreeLine) => {
    const c = frame.rect(line.child);
    const fromAbove = placed.filter(o => o.child === line.child && o.id !== line.id && frame.rect(o.parent).y2 < midY(c)).length;
    return fromAbove === 0 ? 0 : APPROACH_INSET + (fromAbove - 1) * LANE_GAP;
  };
  for (const l of placed) {
    const p = frame.rect(l.parent);
    const c = frame.rect(l.child);
    const trunk = trunkOffset(p.x2 - p.x1);
    const stays = l.kind === 'down' && c.y1 > p.y2 && c.x1 > p.x1 + trunk + 2 + roomFor(l);
    routes.set(l.id, stays
      ? { kind: 'down', parent: l.parent, child: l.child, trunkDx: trunk, slot: NO_SLOT, entryDy: 0 }
      : { kind: 'cross', parent: l.parent, child: l.child, trunkDx: 0, slot: NO_SLOT, entryDy: 0 });
  }
  const labelOf = new Map(placed.map(l => [l.id, l.label ?? '']));
  crossSlots(frame, routes, labelOf);
  assignEntries(frame, routes);
  clearApproaches(frame, routes);
  return routes;
}

type Rect = { id: string; x1: number; y1: number; x2: number; y2: number };

/** One routing pass's boxes, by id and as a list, and each route's street row. */
type Frame = { rects: Rect[]; rect: (id: string) => Rect; streetY: (route: TreeRoute) => number };

function frameOf(info: Map<string, TreeNodeInput>, positions: PositionMap): Frame {
  const boxes = new Map<string, Rect>();
  for (const n of info.values()) {
    const p = positions[n.id];
    if (p) boxes.set(n.id, { id: n.id, x1: p.x - n.width / 2, y1: p.y - n.height / 2, x2: p.x + n.width / 2, y2: p.y + n.height / 2 });
  }
  const none: Rect = { id: '', x1: 0, y1: 0, x2: 0, y2: 0 };
  return {
    rects: [...boxes.values()],
    rect: id => boxes.get(id) ?? none,
    streetY: route => (boxes.get(route.parent)?.y2 ?? 0) + route.slot.streetDy,
  };
}

const midY = (r: Rect) => (r.y1 + r.y2) / 2;
const centreX = (r: Rect) => (r.x1 + r.x2) / 2;

/** The boxes that reach into the band between two rows. */
function within(rects: Rect[], y1: number, y2: number): Rect[] {
  const [ly, hy] = [Math.min(y1, y2), Math.max(y1, y2)];
  return rects.filter(r => r.y1 < hy && ly < r.y2);
}

// True when the segment (x1, y1)–(x2, y2), horizontal or vertical, passes through a box other than `skip`.
function blocked(rects: Rect[], skip: string[], x1: number, y1: number, x2: number, y2: number): boolean {
  const [lx, hx, ly, hy] = [Math.min(x1, x2) - 2, Math.max(x1, x2) + 2, Math.min(y1, y2), Math.max(y1, y2)];
  return rects.some(r => !skip.includes(r.id) && r.x1 < hx && lx < r.x2 && r.y1 < hy && ly < r.y2);
}

// Cross links from a parent into one column (below its street, right of it, no tree line in) share a lane,
// street and a drop left of the column; any other gets its own, the farthest on the outer lane.
function crossSlots(frame: Frame, routes: Map<string, TreeRoute>, labelOf: Map<string, string>): void {
  const withTreeLine = new Set([...routes.values()].filter(r => r.kind === 'down').map(r => r.child));
  const columnOf = (route: TreeRoute): string | null => {
    const p = frame.rect(route.parent);
    const c = frame.rect(route.child);
    return !withTreeLine.has(route.child) && c.y1 > p.y2 + STREET_INSET + STREET_BAND && c.x1 > p.x2 ? `column ${Math.round(c.x1)}` : null;
  };
  const dropKey = (route: TreeRoute) => `${route.parent} column ${Math.round(frame.rect(route.child).x1)}`;
  // One drop per column: the parent with the most lines into it owns it, the farthest reaching on a tie;
  // other parents' lines keep their own slots.
  const claims = new Map<string, Map<string, { lines: number; reach: number }>>();
  for (const route of routes.values()) {
    const key = route.kind === 'cross' ? columnOf(route) : null;
    if (key === null) continue;
    const reach = reachOf(frame, route);
    const parents = claims.get(key) ?? new Map<string, { lines: number; reach: number }>();
    const held = parents.get(route.parent);
    parents.set(route.parent, { lines: (held?.lines ?? 0) + 1, reach: Math.max(held?.reach ?? 0, reach) });
    claims.set(key, parents);
  }
  const owner = new Map<string, string>();
  for (const [key, parents] of claims) {
    const [best] = [...parents].sort(([pa, a], [pb, b]) => b.lines - a.lines || b.reach - a.reach || byId(pa, pb));
    if (best) owner.set(key, best[0]);
  }
  const byParent = new Map<string, [string, TreeRoute][]>();
  for (const [id, route] of routes) {
    if (route.kind === 'cross') byParent.set(route.parent, [...(byParent.get(route.parent) ?? []), [id, route]]);
  }
  // A drop sits a label run left of its column, and left of every other parent's column into its children.
  const all = [...routes.values()];
  const dropStart = (parent: string, unit: [string, TreeRoute][]) => {
    const others = Math.max(0, ...unit.map(([, r]) => all.filter(o => o.kind === 'cross' && o.child === r.child && o.parent !== parent).length));
    const run = labelRunOf(unit.map(([id]) => labelOf.get(id) ?? ''));
    return frame.rect(unit[0]?.[1].child ?? '').x1 - Math.max(run, APPROACH_INSET + others * LANE_GAP);
  };
  // A one-line drop that another line's street into its child crosses gives way to the line's own slot,
  // and the slots are spread again until none changes.
  const split = new Set<string>();
  for (;;) {
    for (const [parent, list] of byParent) {
      const shared = (route: TreeRoute) => {
        const column = columnOf(route);
        return column !== null && owner.get(column) === parent && !split.has(dropKey(route)) ? column : null;
      };
      parentSlots(frame, parent, list, shared, unit => dropStart(parent, unit));
    }
    const crossed = crossedDrops(frame, routes, dropKey).filter(key => !split.has(key));
    if (crossed.length === 0) return;
    for (const key of crossed) split.add(key);
  }
}

const reachOf = (frame: Frame, route: TreeRoute) => Math.abs(centreX(frame.rect(route.child)) - centreX(frame.rect(route.parent)));

// One parent's units, the farthest on the outer lane and top street. Several lines keep a drop with nothing clear:
// on their own streets, at most 2 px apart, their labels would print as one.
function parentSlots(frame: Frame, parent: string, list: [string, TreeRoute][], shared: (route: TreeRoute) => string | null,
  dropStart: (unit: [string, TreeRoute][]) => number): void {
  const p = frame.rect(parent);
  const units = new Map<string, [string, TreeRoute][]>();
  for (const [id, route] of [...list].sort(([a], [b]) => byId(a, b))) {
    const column = shared(route);
    const key = column !== null && dropStart(list.filter(([, r]) => shared(r) === column)) > p.x2 ? column : `line ${id}`;
    units.set(key, [...(units.get(key) ?? []), [id, route]]);
  }
  const reach = (unit: [string, TreeRoute][]) => Math.max(...unit.map(([, r]) => reachOf(frame, r)));
  const ordered = [...units].sort(([ka, a], [kb, b]) => reach(b) - reach(a) || byId(ka, kb));
  const spread = fan((p.x2 - p.x1) / 2, ordered.length);
  const streetGap = ordered.length <= 1 ? 0 : Math.min(STREET_GAP, STREET_BAND / (ordered.length - 1));
  ordered.forEach(([key, unit], k) => {
    const slot: CrossSlot = { laneDx: -(spread.base + k * spread.gap), streetDy: STREET_INSET + k * streetGap, approachDx: -APPROACH_INSET };
    let runLabel = false;
    if (key.startsWith('column')) {
      const columnLeft = frame.rect(unit[0]?.[1].child ?? '').x1;
      const start = dropStart(unit);
      const dropX = clearDrop(frame, p, slot, unit, columnLeft, start) ?? (unit.length > 1 ? start : null);
      if (dropX !== null) {
        slot.approachDx = dropX - columnLeft;
        runLabel = true;
      }
    }
    for (const [, route] of unit) {
      route.slot = { ...slot };
      route.runLabel = runLabel;
    }
  });
}

// A column's drop: the nearest x from `start` leftwards, right of the parent, whose street, drop and runs
// miss every box, or null.
function clearDrop(frame: Frame, p: Rect, slot: CrossSlot, unit: [string, TreeRoute][], columnLeft: number, start: number): number | null {
  const streetY = p.y2 + slot.streetDy;
  const rows = unit.map(([, r]) => midY(frame.rect(r.child)));
  const bottom = Math.max(...rows) + ENTRY_GAP;
  const skip = [p.id, ...unit.map(([, r]) => r.child)];
  const near = within(frame.rects, streetY, bottom);
  const candidates = [start, ...near.map(r => r.x1 - 4)].filter(x => x <= start && x > p.x2).sort((a, b) => b - a);
  return candidates.find(x => !blocked(near, skip, x, streetY, x, bottom)
    && !blocked(frame.rects, skip, p.x2 + slot.laneDx, streetY, x, streetY)
    && rows.every(y => !blocked(near, skip, x, y, columnLeft, y))) ?? null;
}

// The keys of one-line shared drops that another line's street into their child crosses.
function crossedDrops(frame: Frame, routes: Map<string, TreeRoute>, keyOf: (route: TreeRoute) => string): string[] {
  const all = [...routes.values()];
  const lines = new Map<string, number>();
  for (const r of all) if (r.runLabel) lines.set(keyOf(r), (lines.get(keyOf(r)) ?? 0) + 1);
  const crossed = new Set<string>();
  for (const drop of all) {
    if (!drop.runLabel || lines.get(keyOf(drop)) !== 1) continue;
    const dropX = frame.rect(drop.child).x1 + drop.slot.approachDx;
    const top = frame.streetY(drop);
    const bottom = midY(frame.rect(drop.child)) + ENTRY_GAP;
    const hit = all.some(r => r.kind === 'cross' && r.child === drop.child && r.parent !== drop.parent
      && top < frame.streetY(r) && frame.streetY(r) < bottom && frame.rect(r.parent).x2 + r.slot.laneDx < dropX);
    if (hit) crossed.add(keyOf(drop));
  }
  return [...crossed];
}

// A child's own approach columns move left, those from above and those from below each together, into the
// nearest gap clear of boxes; from above they stay right of the child's trunks and shared drops, or jog.
function clearApproaches(frame: Frame, routes: Map<string, TreeRoute>): void {
  const into = new Map<string, TreeRoute[]>();
  for (const route of routes.values()) into.set(route.child, [...(into.get(route.child) ?? []), route]);
  const jogDrops: JogDrop[] = [];
  for (const [child, all] of into) {
    const own = all.filter(r => r.kind === 'cross' && !r.runLabel);
    if (own.length === 0) continue;
    const c = frame.rect(child);
    const others = all.filter(r => !own.includes(r))
      .map(r => (r.kind === 'down' ? frame.rect(r.parent).x1 + r.trunkDx : c.x1 + r.slot.approachDx));
    // A column from above left of a trunk or shared drop into this child would cross that line.
    const floor = Math.max(-Infinity, ...others);
    const above = own.filter(r => frame.streetY(r) < midY(c));
    const below = own.filter(r => frame.streetY(r) >= midY(c));
    if (!shiftClear(frame, c, above, floor)) {
      const taken = [...others, ...own.map(r => c.x1 + r.slot.approachDx)];
      for (const r of above) if (!straightClear(frame, c, r, 0)) jogAround(frame, r, floor, taken, above.filter(o => o !== r), jogDrops);
    }
    shiftClear(frame, c, below, -Infinity);
  }
}

// The line's last vertical (from its street to its entry row) and its run into the child, `shift` left, miss every box.
function straightClear(frame: Frame, c: Rect, r: TreeRoute, shift: number, near: Rect[] = frame.rects): boolean {
  const x = c.x1 + r.slot.approachDx - shift;
  const entryY = midY(c) + r.entryDy;
  return !blocked(near, [r.parent, c.id], x, frame.streetY(r), x, entryY) && !blocked(near, [r.parent, c.id], x, entryY, c.x1, entryY);
}

// Moves `group`'s columns left together to the nearest shift that clears every box and keeps them right of `floor`.
function shiftClear(frame: Frame, c: Rect, group: TreeRoute[], floor: number): boolean {
  if (group.length === 0) return true;
  const rows = group.flatMap(r => [frame.streetY(r), midY(c) + r.entryDy]);
  const near = within(frame.rects, Math.min(...rows), Math.max(...rows));
  const clearAt = (shift: number) => group.every(r =>
    (shift === 0 || c.x1 + r.slot.approachDx - shift > floor + 2) && straightClear(frame, c, r, shift, near));
  if (clearAt(0)) return true;
  const leftmost = Math.min(...group.map(r => c.x1 + r.slot.approachDx));
  const shifts = new Set<number>();
  for (let step = 1; step <= 60; step++) shifts.add(step * LANE_GAP);
  for (const r of near) if (leftmost - r.x2 - 4 > 0) shifts.add(leftmost - r.x2 - 4);
  const best = [...shifts].sort((a, b) => a - b).find(clearAt);
  if (best === undefined) return false;
  for (const r of group) r.slot = { ...r.slot, approachDx: r.slot.approachDx - best };
  return true;
}

type JogDrop = { x: number; top: number; bottom: number };

// No straight drop clears the boxes: drop through the nearest clear column right of `floor` to a row just
// above the child, cross to the approach column, and drop in; else as routed. Two jogs never share a drop.
function jogAround(frame: Frame, route: TreeRoute, floor: number, taken: number[], rest: TreeRoute[], jogDrops: JogDrop[]): void {
  const c = frame.rect(route.child);
  const skip = [route.parent, route.child];
  const streetY = frame.streetY(route);
  const entryY = midY(c) + route.entryDy;
  const approachX = c.x1 + route.slot.approachDx;
  const jogY = c.y1 - ROW_GAP / 2;
  const near = within(frame.rects, streetY, entryY);
  if (jogY <= streetY || blocked(near, skip, approachX, jogY, approachX, entryY) || blocked(near, skip, approachX, entryY, c.x1, entryY)) return;
  // The other lines from above: the jog's row must not cross their columns, nor its drop their streets.
  const between = (x: number, a: number, b: number) => Math.min(a, b) < x && x < Math.max(a, b);
  const crossesRest = (x: number) => rest.some((r) => {
    const column = c.x1 + r.slot.approachDx;
    const street = frame.streetY(r);
    return between(column, x, approachX) || (between(street, streetY, jogY) && between(x, frame.rect(r.parent).x2 + r.slot.laneDx, column));
  });
  // A drop never lies right of both the child and the line's own lane: there the street overshoots and the
  // jog row hooks back.
  const rightmost = Math.max(c.x2, frame.rect(route.parent).x2 + route.slot.laneDx) + 2 * LANE_GAP;
  const candidates = new Set<number>();
  for (let k = 1; k <= 100; k++) candidates.add(approachX + k * LANE_GAP).add(approachX - k * LANE_GAP);
  for (const r of near) candidates.add(r.x2 + 6).add(r.x1 - 6);
  const dropX = [...candidates]
    .filter(x => x > floor + 2 && x <= rightmost && taken.every(t => Math.abs(x - t) >= LANE_GAP) && !crossesRest(x)
      && !jogDrops.some(d => Math.abs(d.x - x) < LANE_GAP && d.top < jogY && streetY < d.bottom))
    .sort((a, b) => Math.abs(a - approachX) - Math.abs(b - approachX) || a - b)
    .find(x => !blocked(near, skip, x, streetY, x, jogY) && !blocked(near, skip, x, jogY, approachX, jogY));
  if (dropX === undefined) return;
  route.slot = { ...route.slot, jog: { dropDx: dropX - c.x1, jogDy: jogY - midY(c) } };
  jogDrops.push({ x: dropX, top: streetY, bottom: jogY });
}

// Entry rows and approach columns share one order so no last turns cross:
// see docs/design/graph-tree-layout.md, Drawing the lines.
function assignEntries(frame: Frame, routes: Map<string, TreeRoute>): void {
  const into = new Map<string, [string, TreeRoute][]>();
  for (const [id, route] of routes) into.set(route.child, [...(into.get(route.child) ?? []), [id, route]]);
  for (const [child, entries] of into) {
    const c = frame.rect(child);
    const childY = midY(c);
    const height = c.y2 - c.y1;
    const group = (route: TreeRoute) => (route.kind === 'down' ? 1 : frame.streetY(route) < childY ? 0 : 2);
    // Shared drops sit left of every own column, so among lines from above they enter lowest, rightmost drop first.
    const key = (route: TreeRoute) => (route.kind === 'down' ? -(frame.rect(route.parent).x1 + route.trunkDx)
      : route.runLabel ? 1e6 - route.slot.approachDx : frame.streetY(route));
    entries.sort(([ia, a], [ib, b]) => group(a) - group(b) || key(a) - key(b) || byId(ia, ib));
    const list = entries.map(([, route]) => route);
    const gap = list.length <= 1 ? 0 : Math.min(ENTRY_GAP, Math.max(0, height - 8) / (list.length - 1));
    list.forEach((route, k) => { route.entryDy = (k - (list.length - 1) / 2) * gap; });

    const fromAbove = list.filter(r => group(r) === 0 && !r.runLabel);
    const fromBelow = list.filter(r => group(r) === 2);
    const column = (i: number) => -(APPROACH_INSET + i * LANE_GAP);
    fromAbove.forEach((route, i) => { route.slot = { ...route.slot, approachDx: column(i) }; });
    // From below after from above, so the two groups never share a column.
    fromBelow.forEach((route, i) => { route.slot = { ...route.slot, approachDx: column(fromAbove.length + fromBelow.length - 1 - i) }; });
  }
}

// A `down` route whose child no longer sits below and right of its trunk (after
// a hide, reveal, reload or drag) is drawn with cross geometry instead.
export function routeGeometry(route: TreeRoute, parent: Box, child: Box): RouteGeometry {
  const parentBottom = parent.y + parent.height / 2;
  const childLeft = child.x - child.width / 2;
  const entryY = child.y + route.entryDy;
  const childEnd = { x: childLeft, y: entryY };
  if (route.kind === 'down') {
    const trunkX = parent.x - parent.width / 2 + route.trunkDx;
    if (entryY > parentBottom + 2 && childLeft > trunkX + 2) {
      return {
        kind: 'down',
        parentEnd: { x: trunkX, y: parentBottom },
        bends: [{ x: trunkX, y: entryY }],
        childEnd,
        labelOffset: (childLeft - trunkX) / 2,
      };
    }
  }
  const laneX = parent.x + parent.width / 2 + route.slot.laneDx;
  const streetY = parentBottom + route.slot.streetDy;
  const approachX = childLeft + route.slot.approachDx;
  const jog = route.slot.jog;
  const lane = { x: laneX, y: streetY };
  // cytoscape puts a segments edge's mid label between its two central bends, so the first bend repeats
  // until those two are the street's ends: twice for a plain cross link, four times for a jog.
  if (jog !== undefined) {
    const dropX = childLeft + jog.dropDx;
    const jogY = child.y + jog.jogDy;
    return {
      kind: 'cross',
      parentEnd: { x: laneX, y: parentBottom },
      bends: [lane, lane, lane, lane, { x: dropX, y: streetY }, { x: dropX, y: jogY }, { x: approachX, y: jogY }, { x: approachX, y: entryY }],
      childEnd,
      labelOffset: 0,
    };
  }
  return {
    kind: 'cross',
    parentEnd: { x: laneX, y: parentBottom },
    bends: [lane, lane, { x: approachX, y: streetY }, { x: approachX, y: entryY }],
    childEnd,
    labelOffset: route.runLabel ? (childLeft - approachX) / 2 : 0,
  };
}
