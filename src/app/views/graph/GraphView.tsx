import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import cytoscape from 'cytoscape';
import {
  fanSubtypeClusters,
  deoverlapNodes,
  separateClusterFans,
  separateLeafFan,
  decollinearNodes,
  arrangeOrganic,
  addGroupPullEdges,
  GROUP_PULL_SELECTOR,
  countEdgeCrossings,
  groupScatter,
  excessWireLength,
  gradeEdgeSpans,
  buildScratchCore,
  organicIters,
  ORGANIC_FALLBACK_THRESHOLD,
  LAYERED_THOROUGHNESS_TINY,
  LAYERED_THOROUGHNESS_SMALL,
  LAYERED_THOROUGHNESS_MEDIUM,
  LAYERED_THOROUGHNESS_LARGE,
  ORGANIC_ITERS_TINY,
  ORGANIC_ITERS_SMALL,
  ORGANIC_ITERS_MEDIUM,
} from './organic-layout';
import type { OrganicIters } from './organic-layout';
import { mountNavigator, teardownNavigator } from './navigator';
import type { NavigatorInstance } from './navigator';
import { buildStyles } from './styles';
import { layoutByGroup } from './grouped-layered';
import { layoutTree, routeGeometry, routeTree } from './tree-layout';
import type { Box, TreeEdgeInput, TreeLine, TreeNodeInput, TreeRoute } from './tree-layout';
import { createEditHistory, USER_HIDDEN_CLASS } from './graph-edits';
import type { GraphEditState, GraphSnapshot, LayoutMode } from './graph-edits';
import { createChangeGlow, glowColors } from './change-glow';
import { createMarkerOverlay, updateMarkers, drawWarningBadges } from './markers';
import { wrapEntityLabel } from './wrap-label';
import { createLayoutStore } from './layout-store';
import type { PositionMap } from './layout-store';
import { parseHash, serializeHash } from '../../hash-router';
import type { HashState, ViewName } from '../../hash-router';
import { buildInheritedConnections } from '../../logic/spotlight-inherited';
import { createHoverIntent } from '../../logic/motion';
import type { Model, ModelNode, ModelEdge, SubtypeCluster } from '../../../model/parse';
import type { EntityError, GlobalError } from '../../../model/validate';
import type { ModelIndex } from '../../../model/model-index';
import type { ChangeReview } from '../../../model/change-review';
import { addMark, entityChanges, type ChangeMark } from '../../logic/change-marks';

/**
 * Class + id prefix for the ephemeral dotted "inferred-upstream" edges drawn on
 * entity select (key-inheritance-lineage CP-B). These edges are NEVER part of
 * the model: they are added to cy AFTER layout, carry the `inherited` class so
 * the lineage-fade keeps them lit, and are stripped before any layout
 * fingerprint / position save and before any re-layout. The id prefix lets us
 * mint collision-free ids and the `edge.inherited` selector lets us remove them
 * wholesale.
 */
const INHERITED_EDGE_CLASS = 'inherited';
const INHERITED_EDGE_PREFIX = '_inherited_';

/** Removed entities and relationships drawn from the baseline. Added after layout and never saved or laid out. */
const CHANGE_GHOST_CLASS = 'change-ghost';
const GHOST_EDGE_PREFIX = '_ghost_';
const GHOST_SPACING = 200;
const GHOST_ROW_GAP = 120;
const GHOST_CLEARANCE = 30;
const GHOST_SEARCH_STEP = 60;
const GHOST_SEARCH_RINGS = 12;

function graphEdgeId(edge: { source: string; target: string }): string {
  return `${edge.source}-${edge.target}`;
}

function nodeData(node: ModelNode) {
  return { id: node.id, label: wrapEntityLabel(node.id), classification: node.classification, group: node.group ?? '' };
}

// Drawn parent → child, the reverse of the model's child → parent edge.
function edgeData(edge: ModelEdge, id: string) {
  return {
    id,
    source: edge.target,
    target: edge.source,
    identifying: String(edge.identifying),
    predicateFwd: edge.predicate.fwd,
    predicateRev: edge.predicate.rev,
    edgeLabel: edge.predicate.fwd,
    predicateMode: 'fwd',
    parentCard: edge.cardinality.parent,
    childCard: edge.cardinality.child,
  };
}

function boxesOverlap(a: cytoscape.BoundingBox12, b: cytoscape.BoundingBox12, gap: number): boolean {
  return a.x1 < b.x2 + gap && a.x2 + gap > b.x1 && a.y1 < b.y2 + gap && a.y2 + gap > b.y1;
}

/** Key and subtype edits arrive as entity-scope `changed` items. */
function changeMarks(review: ChangeReview): { nodes: Map<string, ChangeMark>; edges: Map<string, ChangeMark> } {
  const nodes = new Map([...entityChanges(review)].map(([id, entity]) => [id, entity.mark]));
  const edges = new Map<string, ChangeMark>();
  for (const item of review.items) {
    if (item.scope === 'relationship') addMark(edges, graphEdgeId(item), item.kind, item.status === 'unexplained');
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// LayoutMode — graph-only concept, exported so App shell can read/display it.
// ---------------------------------------------------------------------------

export type { LayoutMode } from './graph-edits';

// ---------------------------------------------------------------------------
// GraphViewHandle — shell↔view typed contract.
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed by GraphView to the shell (App). The shell calls
 * into the view for actions that originate outside the cy surface:
 * - `navigateToEntity`: entity modal link → pan+select in cy + hash write.
 * - `panelNavigate`:    findings/changes panel row → pan+center+select in cy,
 *                       held until a running layout settles.
 * - `resetLayout`:      FAB "Reset layout" action.
 * - `applyLayoutMode`:  FAB layout-mode toggle → re-run ELK in new mode.
 * - zoom ops:           ZoomControl wiring.
 * - `retheme`:          theme-mode change → restyle cy without rebuild.
 * - arrangement edits:  undo/redo, select mode, hide/show nodes (GraphEditBar
 *                       and keyboard), reported back through onGraphEditsChange.
 */
export interface GraphViewHandle {
  navigateToEntity(id: string): void;
  panelNavigate(id: string): void;
  resetLayout(): void;
  applyLayoutMode(mode: LayoutMode): void;
  zoomIn(): void;
  zoomOut(): void;
  setPercent(pct: number): void;
  resetZoom(): void;
  /** Pan the viewport by (dx, dy) screen px — viewport-movement delta, so the
   *  rendered graph slides the opposite way. Keyboard arrow-key scrolling. */
  panBy(dx: number, dy: number): void;
  retheme(mode: 'dark' | 'light', model: Model, entityErrors: EntityError[]): void;
  undo(): void;
  redo(): void;
  toggleSelectMode(): void;
  /** Remove the selected nodes from view. */
  hideSelection(): void;
  /** Put hidden nodes back; null = all of them. */
  showHidden(ids: string[] | null): void;
  /** Remove every entity of the named groups from view. */
  hideGroups(groups: string[]): void;
  /** Put the hidden entities of the named groups back. */
  showGroups(groups: string[]): void;
  /** Remove every entity sharing a group with a selected node. */
  hideSelectionGroups(): void;
}

type GraphEditActions = Pick<GraphViewHandle, 'undo' | 'redo' | 'toggleSelectMode' | 'hideSelection' | 'showHidden' | 'hideGroups' | 'showGroups' | 'hideSelectionGroups'>;

// ---------------------------------------------------------------------------
// GraphViewProps
// ---------------------------------------------------------------------------

export interface GraphViewProps {
  /** The shared graph-panel div that cy mounts into. App owns this element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The minimap container div (rendered by shell inside the graph panel area). */
  minimapRef: React.RefObject<HTMLDivElement | null>;
  /** Whether this view is currently active (view === 'graph'). */
  isActive: boolean;
  /** The parsed+validated entity model. Null = not yet loaded. */
  model: Model | null;
  /** Current theme mode — drives initial cy stylesheet. */
  themeMode: 'dark' | 'light';
  /** O(1) model index — used for node lookup on tap/hash-restore/panel-navigate. */
  modelIndex: ModelIndex | null;
  /** Current findings — used for warning-badge overlay after layout. */
  findings: { globalErrors: GlobalError[]; entityErrors: EntityError[] };
  /** The layout-store key for the current model topology. */
  layoutKey: string;
  /** Whether the minimap is currently open (controls navigator mount). */
  minimapOpen: boolean;
  /** Initial layout mode (read once; changes arrive via applyLayoutMode handle). */
  initialLayoutMode: LayoutMode;
  /** Active graph-search match set (entity ids). Null = no active search — no
   *  search-* classes applied. Applied as `search-match`/`search-dim` classes
   *  (graph-flow-search CP2); survives hover tiers, lineage, layout changes,
   *  and SSE model refresh (reapplied on cy rebuild). */
  searchMatches: ReadonlySet<string> | null;
  /** Changes to highlight, with ghost elements for removals. Null = no highlights. */
  changeReview: ChangeReview | null;
  /** Called when cy readiness changes (true = cy alive; false = cy destroyed). */
  onCyReadyChange(ready: boolean): void;
  /** Called on every cy zoom event with the readout percent (100 = fit baseline). */
  onZoomPercentChange(pct: number): void;
  /** Called when layout mode changes internally (not from shell — future-proof). */
  onLayoutModeChange(mode: LayoutMode): void;
  /** Called when cy init throws. Null = no error (cleared on re-init). */
  onCyInitError(msg: string | null): void;
  /** Called when the user taps a node — shell shows the rich entity modal. */
  onSelectEntity(node: ModelNode): void;
  /** Called when the user taps the background — shell hides the entity modal. */
  onDeselectEntity(): void;
  /** Called by the findings-panel navigate path — select + center only, no modal open. */
  onPanelSelect(node: ModelNode): void;
  /** Called whenever undo/redo availability, select mode, or the hidden set changes. */
  onGraphEditsChange(state: GraphEditState): void;
}

// ---------------------------------------------------------------------------
// GraphView component
// ---------------------------------------------------------------------------

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  function GraphView(
    {
      containerRef,
      minimapRef,
      isActive,
      model,
      themeMode,
      modelIndex,
      findings,
      layoutKey,
      minimapOpen,
      initialLayoutMode,
      searchMatches,
      changeReview,
      onCyReadyChange,
      onZoomPercentChange,
      onLayoutModeChange,
      onCyInitError,
      onSelectEntity,
      onDeselectEntity,
      onPanelSelect,
      onGraphEditsChange,
    },
    ref,
  ) {
    // ── internal refs ──────────────────────────────────────────────────────
    const cyRef = useRef<cytoscape.Core | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const navRef = useRef<NavigatorInstance | null>(null);

    // Ref mirrors so closures always see live values without deps churn.
    const themeModeRef = useRef<'dark' | 'light'>(themeMode);
    themeModeRef.current = themeMode;

    const layoutKeyRef = useRef<string>(layoutKey);
    layoutKeyRef.current = layoutKey;

    const modelIndexRef = useRef<ModelIndex | null>(modelIndex);
    modelIndexRef.current = modelIndex;

    const findingsRef = useRef(findings);
    findingsRef.current = findings;

    // searchMatchesRef: read by applySearchClasses (defined inside cy-init,
    // wired to applySearchClassesRef below) so the reapply effect below never
    // needs the cy-init effect to re-run when the term changes mid-typing.
    const searchMatchesRef = useRef<ReadonlySet<string> | null>(searchMatches);
    searchMatchesRef.current = searchMatches;

    const changeReviewRef = useRef<ChangeReview | null>(changeReview);
    changeReviewRef.current = changeReview;

    // minimapOpenRef: read by cy effect on mount (avoid adding minimapOpen to deps).
    const minimapOpenRef = useRef<boolean>(minimapOpen);
    minimapOpenRef.current = minimapOpen;

    // Layout mode — seeded from initialLayoutMode; only mutated internally.
    const layoutModeRef = useRef<LayoutMode>(initialLayoutMode);

    // Refs wired inside cy-init so the handle can call them outside the closure.
    const navigateToEntityRef = useRef<(id: string) => void>(() => {});
    const panelNavigateRef = useRef<(id: string) => void>(() => {});
    const resetLayoutRef = useRef<(() => void) | null>(null);
    const applyLayoutModeRef = useRef<((mode: LayoutMode, before: LayoutMode) => void) | null>(null);
    const graphEditsRef = useRef<GraphEditActions | null>(null);
    // Outlives a cy rebuild, so a live reload does not wipe what can be undone.
    const editHistoryRef = useRef(createEditHistory());

    // ── Shift+hover lineage state (DG lineage trigger = shift+hover) ──────────
    // The currently-hovered node id (set on mouseover, cleared on mouseout) and
    // whether shift+hover lineage mode is currently displayed. Both are refs so
    // the document-level Shift keydown/keyup listeners read live values without
    // a stale closure — matching this file's existing ref pattern. The enter/exit
    // callbacks are also mirrored into refs so the keydown/keyup listeners (wired
    // once per cy-init) call the live cy-bound implementations.
    const hoveredNodeIdRef = useRef<string | null>(null);
    const lineageActiveRef = useRef<boolean>(false);
    const enterLineageHoverRef = useRef<((nodeId: string) => void) | null>(null);
    const exitLineageHoverRef = useRef<(() => void) | null>(null);
    // Wired inside cy-init to the local redrawMarkers closure (clears + redraws badges).
    const redrawMarkersRef = useRef<(() => void) | null>(null);
    // Wired inside cy-init to the local applySearchClasses closure (search-match/
    // search-dim class application, keyed off searchMatchesRef).
    const applySearchClassesRef = useRef<(() => void) | null>(null);
    const applyChangeOverlayRef = useRef<(() => void) | null>(null);
    const cyZoomInRef = useRef<(() => void) | null>(null);
    const cyZoomOutRef = useRef<(() => void) | null>(null);
    const cySetPercentRef = useRef<((pct: number) => void) | null>(null);
    const cyZoomResetRef = useRef<(() => void) | null>(null);

    // cyReady: true while cy is alive. Used by navigator toggle effect.
    const [cyReady, setCyReady] = useState(false);

    // Expose handle to shell.
    useImperativeHandle(ref, () => ({
      navigateToEntity(id: string) {
        navigateToEntityRef.current(id);
      },
      panelNavigate(id: string) {
        panelNavigateRef.current(id);
      },
      resetLayout() {
        resetLayoutRef.current?.();
      },
      applyLayoutMode(mode: LayoutMode) {
        const before = layoutModeRef.current;
        layoutModeRef.current = mode;
        applyLayoutModeRef.current?.(mode, before);
      },
      zoomIn() {
        cyZoomInRef.current?.();
      },
      zoomOut() {
        cyZoomOutRef.current?.();
      },
      setPercent(pct: number) {
        cySetPercentRef.current?.(pct);
      },
      resetZoom() {
        cyZoomResetRef.current?.();
      },
      panBy(dx: number, dy: number) {
        // cy.panBy moves the RENDERED CONTENT by the given px; the viewport
        // moving right means the content slides left, hence the negation.
        cyRef.current?.panBy({ x: -dx, y: -dy });
      },
      retheme(mode: 'dark' | 'light', m: Model, entityErrors: EntityError[]) {
        const cy = cyRef.current;
        const svg = svgRef.current;
        if (!cy || !svg) return;
        cy.style(buildStyles(m.groups, m.theme, mode));
        cy.forceRender();
        updateMarkers(cy, svg, m.theme, mode);
        const badgeIds = new Set(entityErrors.map(e => e.entityId));
        drawWarningBadges(cy, svg, badgeIds);
      },
      undo() {
        graphEditsRef.current?.undo();
      },
      redo() {
        graphEditsRef.current?.redo();
      },
      toggleSelectMode() {
        graphEditsRef.current?.toggleSelectMode();
      },
      hideSelection() {
        graphEditsRef.current?.hideSelection();
      },
      showHidden(ids: string[] | null) {
        graphEditsRef.current?.showHidden(ids);
      },
      hideGroups(groups: string[]) {
        graphEditsRef.current?.hideGroups(groups);
      },
      showGroups(groups: string[]) {
        graphEditsRef.current?.showGroups(groups);
      },
      hideSelectionGroups() {
        graphEditsRef.current?.hideSelectionGroups();
      },
    }), []);

    // ── Warning badge redraw on findings change (F-6) ─────────────────────
    // When the server sends a new model-changed SSE event, entityErrors may change
    // while cy is already alive (no cy-init re-run). Redraw badges so stale
    // warning triangles don't linger after the model is fixed in the editor.
    // redrawMarkersRef is wired to the cy-init closure which calls updateMarkers
    // (clears the SVG overlay) then drawWarningBadges — handles the 1-error→0
    // transition correctly because updateMarkers always wipes before redrawing.
    useEffect(() => {
      if (!isActive) return;
      redrawMarkersRef.current?.();
    }, [findings.entityErrors, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Search class reapply (graph-flow-search CP2, SC1/SC4) ──────────────
    // Runs on every searchMatches change (live as the shell debounces the
    // term) AND whenever cyReady flips true — which covers the cy-rebuild
    // paths (SSE model refresh, initial mount) where the fresh cy instance
    // starts with no search-* classes and must have the ACTIVE term reapplied
    // without the user retyping it (SC4).
    useEffect(() => {
      if (!isActive || !cyReady) return;
      applySearchClassesRef.current?.();
    }, [searchMatches, isActive, cyReady]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!isActive || !cyReady) return;
      applyChangeOverlayRef.current?.();
    }, [changeReview, isActive, cyReady]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Navigator toggle effect (CP18) ─────────────────────────────────────
    // Runs on minimapOpen, cyReady, and isActive changes.
    // Gated on isActive so the navigator is torn down when leaving graph view,
    // preventing the cy 'resize' subscription from surviving a view switch
    // (which is exactly the CP18 crash scenario).
    useEffect(() => {
      if (!cyReady) return;
      const cy = cyRef.current;
      if (!cy) return;

      if (!isActive) {
        if (navRef.current) {
          teardownNavigator(navRef.current, minimapRef.current);
          navRef.current = null;
        }
        return;
      }

      if (minimapOpen) {
        if (!navRef.current && minimapRef.current) navRef.current = mountNavigator(cy);
      } else if (navRef.current) {
        teardownNavigator(navRef.current, minimapRef.current);
        navRef.current = null;
      }
    }, [minimapOpen, cyReady, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Cy-init effect ─────────────────────────────────────────────────────
    useEffect(() => {
      if (!isActive) return;
      if (!model || !containerRef.current) return;

      onCyInitError(null);

      // Capture as non-null binding so nested closures don't re-check.
      const modelNonNull = model;
      const elements: cytoscape.ElementDefinition[] = [];
      // Local id→element map for O(1) parent-wiring in the cluster loop below (L3).
      const elementById = new Map<string, cytoscape.ElementDefinition>();

      // Build a set of subtype edges (child→parent) so we can rewire through joiners.
      const subtypeEdgeKeys = new Set<string>();
      for (const cluster of model.subtypeClusters) {
        for (const member of cluster.members) {
          subtypeEdgeKeys.add(`${member}-${cluster.basetype}`);
        }
      }

      for (const node of model.nodes) {
        const el: cytoscape.ElementDefinition = { data: nodeData(node) };
        elements.push(el);
        elementById.set(node.id, el);
      }

      // Add compound cluster nodes, joiner nodes, and rewire subtype edges.
      for (const cluster of model.subtypeClusters) {
        const clusterId = `_cluster_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;
        const joinerId = `_joiner_${cluster.basetype}_${cluster.exclusive ? 'x' : 'i'}`;

        elements.push({
          data: { id: clusterId, label: '', cluster: 'true' },
        });

        elements.push({
          data: {
            id: joinerId,
            label: cluster.exclusive ? 'X' : '',
            joiner: 'true',
            exclusive: String(cluster.exclusive),
          },
        });

        elements.push({
          data: {
            id: `${cluster.basetype}-${joinerId}`,
            source: cluster.basetype,
            target: joinerId,
            identifying: 'true',
            edgeLabel: '',
            parentCard: '1',
            childCard: '',
            subtypeEdge: 'true',
          },
        });

        for (const member of cluster.members) {
          const nodeEl = elementById.get(member);
          if (nodeEl) nodeEl.data.parent = clusterId;

          elements.push({
            data: {
              id: `${joinerId}-${member}`,
              source: joinerId,
              target: member,
              identifying: 'true',
              edgeLabel: '',
              parentCard: '',
              childCard: '0..1',
              subtypeEdge: 'true',
            },
          });
        }
      }

      for (const edge of model.edges) {
        const id = graphEdgeId(edge);
        if (subtypeEdgeKeys.has(id)) continue;
        elements.push({ data: edgeData(edge, id) });
      }

      const longestPredicate = model.edges.reduce(
        (max, e) => Math.max(max, e.predicate.fwd.length), 0,
      );
      const charWidth = 6;
      const markerPadding = 50;
      const layerPadding = 30;
      const layerSpacing = Math.max(110, longestPredicate * charWidth + markerPadding + layerPadding);

      const entityCount = model.nodes.length;

      function layeredThoroughness(): number {
        if (entityCount < 50)  return LAYERED_THOROUGHNESS_TINY;
        if (entityCount < 100) return LAYERED_THOROUGHNESS_SMALL;
        if (entityCount < 200) return LAYERED_THOROUGHNESS_MEDIUM;
        return LAYERED_THOROUGHNESS_LARGE;
      }

      function effectiveAlgorithm(mode: LayoutMode): 'fcose' | 'layered' | 'tree' {
        if (mode === 'tree') return 'tree';
        if (mode === 'organic' && entityCount >= ORGANIC_FALLBACK_THRESHOLD) return 'layered';
        return mode === 'organic' ? 'fcose' : 'layered';
      }

      // Degree-1 leaves at the moment a layout run starts. Snapshotted by
      // runLayout BEFORE it injects the ephemeral group-pull edges (which give
      // every grouped node +1 degree and would otherwise unmask the satellites),
      // read by the fcose idealEdgeLength callback during the run.
      const satelliteIds = new Set<string>();

      // Multi-seed search bookkeeping. The generation token lets a newer run
      // (Reset / mode toggle) abort a search still stepping through its
      // candidates. The weight converts group scatter (member-summed, in
      // mean-edge-lengths) into crossing-equivalents: one member sitting one
      // edge-length off its family centroid ≈ 4 crossings, so scattering a
      // whole family costs far more than a handful of extra line crossings.
      let layoutSearchGen = 0;
      const GROUP_SCATTER_WEIGHT = 4;
      // One median-edge-length of excess wire ≈ 3 crossings: candidates that
      // seat bridge nodes amid their neighbours beat ones with long tethers.
      const WIRE_EXCESS_WEIGHT = 3;

      const buildLayoutOpts = (mode: LayoutMode): cytoscape.LayoutOptions => {
        const algo = effectiveAlgorithm(mode);
        if (algo === 'fcose') {
          // fCoSE: a spring-electrical force sim for GLOBAL placement — edges are
          // springs, so related nodes (e.g. individual + its auth tables) stay
          // close instead of being flung apart like ELK stress did. It runs
          // incrementally from the deterministic seed (randomize:false) so a
          // Reset is reproducible. LOCAL polish — subtype fans, cluster spacing,
          // de-overlap — is layered on afterwards by arrangeOrganic (below).
          // Keep springs SHORT: the sim finds its cleanest global organization
          // at compact scale (long springs settle into tangled minima). The
          // breathing room the compact solution lacks is added afterwards by
          // expandCore in arrangeOrganic — a geometric inflation that cannot
          // introduce new crossings.
          const idealLength = Math.max(210, Math.round(layerSpacing * 1.3));
          // Satellite edges — one endpoint is a degree-1 leaf (classifier/type
          // boxes) — stay short, so leaves hug their entity instead of renting
          // space in the core. The dominant clutter on real models is long
          // dashed classifier edges spanning the whole graph. Membership is
          // read from satelliteIds (snapshotted by runLayout BEFORE the
          // ephemeral group-pull edges skew every grouped node's degree).
          const isSatellite = (e: cytoscape.EdgeSingular) =>
            satelliteIds.has(e.source().id()) || satelliteIds.has(e.target().id());
          return {
            name: 'fcose',
            quality: 'proof',
            randomize: true, // keep the spectral draft; runLayout pins Math.random for reproducibility
            animate: false,
            fit: false,
            nodeDimensionsIncludeLabels: true,
            packComponents: true,
            nodeSeparation: Math.max(150, Math.round(model.theme.spacing.nodeSep * 1.25)),
            // Group-pull springs are long + soft: "stay in the neighbourhood",
            // never "crush the family onto its anchor" — real FK edges keep
            // 3× the elasticity so they still dictate the fine structure.
            idealEdgeLength: (e: cytoscape.EdgeSingular) => {
              if (e.data('groupPull')) return Math.round(idealLength * 1.6);
              return isSatellite(e) ? Math.round(idealLength * 0.5) : idealLength;
            },
            edgeElasticity: (e: cytoscape.EdgeSingular) => (e.data('groupPull') ? 0.25 : 0.45),
            // Moderate repulsion: 8000 (used while satellites still rented core
            // space) overpowers the springs — degree-2 families like the oauth
            // tokens get blown apart into long parallel edges. With leaves
            // docked, 5000 keeps clusters tight without recrowding the core.
            nodeRepulsion: 5000,
            gravity: 0.45,
            gravityRange: 3.4,
            numIter: 2500,
          } as cytoscape.LayoutOptions;
        }
        const inOrganicFallback = mode === 'organic' && entityCount >= ORGANIC_FALLBACK_THRESHOLD;
        const useExpensiveStrategies = !inOrganicFallback && entityCount < 200;
        const thoroughness = inOrganicFallback ? LAYERED_THOROUGHNESS_LARGE : layeredThoroughness();
        return {
          name: 'elk',
          elk: {
            algorithm: 'layered',
            'elk.direction': 'DOWN',
            'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
            'elk.spacing.nodeNode': String(model.theme.spacing.nodeSep),
            'elk.edgeRouting': useExpensiveStrategies ? 'ORTHOGONAL' : 'POLYLINE',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
            'elk.layered.thoroughness': String(thoroughness),
            'elk.layered.nodePlacement.strategy': useExpensiveStrategies ? 'NETWORK_SIMPLEX' : 'BRANDES_KOEPF',
            'elk.layered.nodePlacement.favorStraightEdges': 'true',
            'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.compaction.postCompaction.strategy': 'NONE',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          },
        } as cytoscape.LayoutOptions;
      };

      // L1: skip ELK when a cached layout already covers this model topology.
      const layoutStore = createLayoutStore();
      const preloadedSavedKey = layoutKeyRef.current;
      const preloadedSaved = preloadedSavedKey ? layoutStore.load(preloadedSavedKey) : null;
      // A model edit changes the layout key; the arrangement saved under the
      // previous key carries over and only the new nodes need a spot.
      const entityIds = new Set(model.nodes.map(n => n.id));
      const carried = preloadedSaved ? null : layoutStore.previous(preloadedSavedKey, [...entityIds]);
      const savedHidden = preloadedSaved ? layoutStore.hidden(preloadedSavedKey) : carried?.hidden ?? [];
      let hiddenIds = new Set(savedHidden.filter(id => entityIds.has(id)));

      // Apply a saved PositionMap onto a cy instance.
      // Skips compound parents (_cluster_*) — setting a parent translates its children,
      // displacing them from their own saved absolute coordinates.
      function applySavedPositions(cyInst: cytoscape.Core, saved: PositionMap): void {
        for (const [id, pos] of Object.entries(saved)) {
          const node = cyInst.$id(id);
          if (!node.empty() && !node.isParent()) node.position(pos);
        }
      }

      // Construct with the null layout, then run the real layout explicitly AFTER
      // the layoutstop handler is attached (below). fCoSE — like preset — fires
      // layoutstop synchronously on run; constructing with it directly would fire
      // the event before the handler exists, so fit/de-overlap would never run.
      // ELK (async) tolerated the old constructor path but works here too.
      const nullLayoutOpts = { name: 'null' } satisfies cytoscape.LayoutOptions;
      const chosenLayout = nullLayoutOpts;

      let cy: cytoscape.Core;
      try {
        cy = cytoscape({
          container: containerRef.current,
          elements,
          layout: chosenLayout,
          style: buildStyles(model.groups, model.theme, themeMode),
          minZoom: 0.3,
          maxZoom: 3,
          wheelSensitivity: 0.2,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ignatius] Cytoscape init failed:', msg);
        onCyInitError(msg);
        return;
      }
      window.__IGNATIUS_CY__ = cy;
      const changeGlow = createChangeGlow(cy, containerRef.current, () => glowColors(model.theme, themeModeRef.current));

      // Build and run the layout for a mode, then invoke onDone. runLayout owns
      // layout creation (cytoscape snapshots the element set at cy.layout()
      // time, so the ephemeral group-pull edges must be in the graph before the
      // layout object exists) and owns completion signalling: the fCoSE path
      // runs TWO synchronous passes, so callers cannot key off layoutstop —
      // the first pass would fire it early.
      //
      // fCoSE's spectral draft pulls from Math.random, so each run lands
      // somewhere new; pin Math.random to a fixed PRNG for the synchronous run
      // (then restore) so a Reset is reproducible while keeping the spectral
      // draft's quality. Non-fCoSE layouts run untouched.
      const runLayout = (m: LayoutMode, onDone: () => void) => {
        if (effectiveAlgorithm(m) === 'tree') {
          ++layoutSearchGen;
          const { nodes, edges } = treeInput();
          const result = layoutTree(nodes, edges);
          treeLines = linesOf(result.routes);
          applySavedPositions(cy, result.positions);
          onDone();
          return;
        }
        if (effectiveAlgorithm(m) !== 'fcose') {
          const scratch = buildScratchCore(cy, true, hiddenNodeIds());
          const myGen = ++layoutSearchGen;
          void layoutByGroup(scratch, buildLayoutOpts(m), layerSpacing).then((positions) => {
            scratch.destroy();
            if (cy.destroyed() || layoutSearchGen !== myGen) return;
            applySavedPositions(cy, positions);
            onDone();
          });
          return;
        }
        // The search runs on a HEADLESS scratch mirror of the graph: once the
        // live core has painted, every element read/write pays renderer
        // bookkeeping (label re-measures, compound bounds, notify) — measured
        // at seconds per candidate versus milliseconds headless. The live
        // graph keeps its current picture until the winner is applied.
        // Above ~150 entities the flat force problem starts to tangle —
        // decompose by colour family via compound regions on the mirror.
        const scratch = buildScratchCore(cy, entityCount >= 150, hiddenNodeIds());
        // Snapshot degree-1 leaves from REAL degrees — the group-pull edges
        // added in pass 2 would otherwise give every grouped satellite +1
        // degree and unmask it from the short-leash treatment.
        satelliteIds.clear();
        scratch.nodes(':childless').forEach((n) => { if (n.degree(false) === 1) satelliteIds.add(n.id()); });
        // Multi-seed search: a force sim has no force that "sees" an edge
        // crossing, so the only route to fewer crossings is to solve from
        // several deterministic seeds and keep the best finished candidate.
        // Fitness = crossings + weighted group scatter — crossings alone would
        // pick a low-crossing candidate that scatters the colour families.
        // The seed list is fixed, the score is deterministic, and strict
        // less-than keeps the first best — so first load and every Reset still
        // land on the byte-identical winner.
        //
        // Candidates run ONE PER MACROTASK so the page stays responsive. A
        // generation token aborts a stale search when a newer run (Reset,
        // mode toggle) starts.
        // Candidate count scales DOWN with model size: headless candidates
        // cost ~0.3s at 100 nodes but ~1.3s at 200, and past ~250 entities
        // organic falls back to layered anyway (a 400-node force layout is a
        // hairball no matter how many seeds you try). 12 seeds under 100
        // nodes, 8 to 150, 5 up to the fallback threshold — keeps first-load
        // layout in single-digit seconds across the whole organic range.
        const ALL_SEEDS = [
          0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x452821e6, 0x38d01377, 0xbe5466cf,
          0x34e90c6c, 0xc97c50dd, 0x8f1bbcdc, 0x2ffd72db, 0xd01adfb7, 0xa4093822,
        ];
        const SEEDS = ALL_SEEDS.slice(0, entityCount < 100 ? 12 : entityCount < 150 ? 8 : entityCount < 250 ? 5 : 3);
        const myGen = ++layoutSearchGen;
        let best: PositionMap | null = null;
        let bestScore = Infinity;

        const runCandidate = (seed: number) => {
          const origRandom = Math.random;
          let s = seed >>> 0;
          Math.random = () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          try {
            // Each candidate starts from the same state: no leftover pull
            // edges, every node collapsed to the origin (fCoSE reads current
            // positions even with randomize:true), PRNG reseeded.
            scratch.remove(GROUP_PULL_SELECTOR);
            scratch.nodes().forEach((n) => { if (!n.isParent()) n.position({ x: 0, y: 0 }); });
            // The GLOBAL passes run on uniform node dims (fixed box, no
            // label). Real label-sized boxes are wide and uneven; they distort
            // the spring equilibrium into a visibly messier arrangement — and
            // label-measurement timing would make the first load differ from
            // every Reset (labels are unmeasured on the very first run).
            scratch.nodes().addClass('layout-uniform');
            // Pass 1 — global structure from pure FK topology. Solving WITH
            // the group springs from scratch settles into a tangled minimum;
            // solving without them first keeps the clean structure-driven
            // picture.
            scratch.layout(buildLayoutOpts(m)).run();
            // Pass 2 — group cohesion as an incremental refinement: same-group
            // attraction springs + randomize:false morph the pass-1 layout so
            // each colour family drifts into one neighbourhood without a
            // re-solve.
            addGroupPullEdges(scratch);
            scratch.layout({
              ...buildLayoutOpts(m),
              randomize: false,
              numIter: 1200,
            } as cytoscape.LayoutOptions).run();
            // Local polish uses REAL dimensions (docking, fans, de-overlap),
            // so the uniform class comes off before it.
            scratch.nodes().removeClass('layout-uniform');
            arrangeOrganic(scratch, organicIters(entityCount));
          } finally {
            Math.random = origRandom;
          }
          const score = countEdgeCrossings(scratch)
            + GROUP_SCATTER_WEIGHT * groupScatter(scratch)
            + WIRE_EXCESS_WEIGHT * excessWireLength(scratch);
          if (score < bestScore) {
            bestScore = score;
            const snap: PositionMap = {};
            scratch.nodes(':childless').forEach((n) => {
              const p = n.position();
              snap[n.id()] = { x: p.x, y: p.y };
            });
            best = snap;
          }
        };

        // Step candidates via a MessageChannel macrotask, NOT setTimeout —
        // browsers throttle chained timers on hidden/background pages to as
        // little as one wake per second, turning a ~2s search into a minute.
        // A ported message yields to the event loop (paints, input) without
        // any throttling.
        const chan = new MessageChannel();
        const finish = () => {
          chan.port1.close();
          chan.port2.close();
          scratch.destroy();
        };
        let i = 0;
        const step = () => {
          if (cy.destroyed() || layoutSearchGen !== myGen) { finish(); return; } // superseded
          const seed = SEEDS[i++];
          if (seed !== undefined) runCandidate(seed);
          if (i < SEEDS.length) {
            chan.port2.postMessage(null);
          } else {
            finish();
            if (best) applySavedPositions(cy, best);
            onDone();
          }
        };
        chan.port1.onmessage = step;
        step();
      };
      window.__IGNATIUS_CY_GEN__ = (window.__IGNATIUS_CY_GEN__ ?? 0) + 1;

      if (!svgRef.current) {
        svgRef.current = createMarkerOverlay(containerRef.current);
      }
      const svg = svgRef.current;

      const redrawMarkers = () => {
        if (cy.destroyed()) return;
        updateMarkers(cy, svg, model.theme, themeModeRef.current);
        const badgeIds = new Set(findingsRef.current.entityErrors.map(e => e.entityId));
        drawWarningBadges(cy, svg, badgeIds);
      };
      redrawMarkersRef.current = redrawMarkers;

      // ── Graph search classes (graph-flow-search CP2) ───────────────────────
      // search-match / search-dim are DEDICATED classes, distinct from the
      // hover-tier classes (faded/inherited-dim/hover-focus) and the ephemeral
      // .inherited lineage class — clearFocusTiers/clearInheritedEdges never
      // touch them, so hover, shift-lineage, background tap, and layout
      // changes cannot erase active search dimming (SC4). Reads the match set
      // from searchMatchesRef (never stale — mirrored every render), so the
      // reapply effect above can call this without the cy-init effect
      // re-running on every keystroke.
      function applySearchClasses(): void {
        if (cy.destroyed()) return;
        cy.elements().removeClass('search-match search-dim');
        const matches = searchMatchesRef.current;
        if (!matches) return; // no active search — leave every element undimmed
        const matchedNodes = cy.nodes().filter(n => matches.has(n.id()));
        const unmatchedNodes = cy.nodes().difference(matchedNodes);
        matchedNodes.addClass('search-match');
        unmatchedNodes.addClass('search-dim');
        // An edge stays undimmed only when BOTH endpoints match (SC1).
        cy.edges()
          .filter(e => !(matches.has(e.source().id()) && matches.has(e.target().id())))
          .addClass('search-dim');
      }
      applySearchClassesRef.current = applySearchClasses;

      // Ghosts are placed around laid-out nodes, so the overlay waits for a
      // layout to finish and comes off before the next one starts.
      let layoutSettled = false;
      // Re-adding ghosts drops their selection, so an unchanged review is not reapplied.
      let appliedReview: ChangeReview | null | undefined;
      // A panel click that lands mid-layout waits here, or the closing fit would undo its centering.
      let pendingPanelTarget: string | null = null;

      function settleLayout(): void {
        layoutSettled = true;
        appliedReview = undefined;
        applyEdgeRouting();
        applyChangeOverlay();
      }

      function unsettleLayout(): void {
        cy.remove(`.${CHANGE_GHOST_CLASS}`);
        layoutSettled = false;
      }

      function gradeSpans(): void {
        gradeEdgeSpans(cy.edges(':visible').not(`.${CHANGE_GHOST_CLASS}`));
      }

      function markElement(el: cytoscape.CollectionReturnValue, mark: ChangeMark): void {
        el.data('change', mark.change);
        if (mark.unexplained) el.data('unexplained', 'true');
      }

      function ghostStart(id: string, review: ChangeReview, nextRowSlot: () => cytoscape.Position): cytoscape.Position {
        const neighbourIds = review.removedEdges
          .flatMap(edge => (edge.source === id ? [edge.target] : edge.target === id ? [edge.source] : []));
        const saved = layoutStore.lastPosition(id, layoutKeyRef.current, neighbourIds);
        if (saved) return saved;
        const neighbours = neighbourIds
          .map(neighbourId => cy.$id(neighbourId))
          .filter(neighbour => neighbour.nonempty());
        if (neighbours.length === 0) return nextRowSlot();
        return centroid(neighbours.reduce((all, n) => all.union(n), cy.collection()));
      }

      function centroid(nodes: cytoscape.NodeCollection): cytoscape.Position {
        let x = 0;
        let y = 0;
        nodes.forEach((n) => { x += n.position('x'); y += n.position('y'); });
        return { x: x / nodes.length, y: y / nodes.length };
      }

      function moveToClearSpot(
        ghost: cytoscape.NodeSingular,
        start: cytoscape.Position,
        nextRowSlot: () => cytoscape.Position,
        blockers: cytoscape.NodeCollection = cy.nodes(':visible'),
      ): void {
        ghost.position(start);
        const home = ghost.boundingBox();
        const blocked = blockers.not(ghost).map(n => n.boundingBox());
        for (let ring = 0; ring <= GHOST_SEARCH_RINGS; ring++) {
          const spots = ring === 0 ? 1 : 8;
          for (let k = 0; k < spots; k++) {
            const angle = (2 * Math.PI * k) / spots;
            const dx = Math.cos(angle) * ring * GHOST_SEARCH_STEP;
            const dy = Math.sin(angle) * ring * GHOST_SEARCH_STEP;
            const box = { x1: home.x1 + dx, x2: home.x2 + dx, y1: home.y1 + dy, y2: home.y2 + dy };
            if (blocked.every(other => !boxesOverlap(box, other, GHOST_CLEARANCE))) {
              ghost.position({ x: start.x + dx, y: start.y + dy });
              return;
            }
          }
        }
        ghost.position(nextRowSlot());
      }

      // Spots along a row under `placed`, for a node with nowhere better to go.
      function rowSlotsBelow(placed: cytoscape.NodeCollection): () => cytoscape.Position {
        const box = placed.boundingBox();
        const left = Number.isFinite(box.x1) ? box.x1 : 0;
        const top = Number.isFinite(box.y2) ? box.y2 + GHOST_ROW_GAP : 0;
        let rowSlots = 0;
        return () => ({ x: left + rowSlots++ * GHOST_SPACING, y: top });
      }

      function addChangeGhosts(review: ChangeReview, nodeMarks: Map<string, ChangeMark>, edgeMarks: Map<string, ChangeMark>): void {
        const nextRowSlot = rowSlotsBelow(cy.nodes(':visible'));

        for (const node of review.removedNodes) {
          if (cy.$id(node.id).nonempty()) continue;
          const start = ghostStart(node.id, review, nextRowSlot);
          const ghost = cy.add({ group: 'nodes', data: nodeData(node), classes: CHANGE_GHOST_CLASS });
          moveToClearSpot(ghost, start, nextRowSlot);
          markElement(ghost, { change: 'removed', unexplained: nodeMarks.get(node.id)?.unexplained ?? false });
        }

        for (const edge of review.removedEdges) {
          const id = GHOST_EDGE_PREFIX + graphEdgeId(edge);
          if (cy.$id(edge.source).empty() || cy.$id(edge.target).empty() || cy.$id(id).nonempty()) continue;
          const ghost = cy.add({ group: 'edges', data: edgeData(edge, id), classes: CHANGE_GHOST_CLASS });
          markElement(ghost, { change: 'removed', unexplained: edgeMarks.get(graphEdgeId(edge))?.unexplained ?? false });
        }
      }

      // Hover state lives up here: the first layout can land synchronously (a
      // saved arrangement) and reach the hover through an edit it triggers.
      let hoverShownId: string | null = null;
      // Read when a hover settles, after the pointer event that started it is gone.
      let shiftHeld = false;
      const graphHover = createHoverIntent(showHover);

      // ── Tree layout edge routing (docs/design/graph-tree-layout.md) ────────
      // Bends are relative to the endpoints, so they are recomputed whenever a node moves.
      const TREE_EDGE_CLASSES = 'tree-edge tree-label-source tree-cross';
      const TREE_EDGE_STYLES = 'segment-weights segment-distances source-endpoint target-endpoint source-text-offset target-text-offset';
      let treeRoutes = new Map<string, TreeRoute>();
      // Which lines the last Tree layout drew as tree lines; later routing keeps
      // them and works from the boxes as they stand, so nothing reorders.
      let treeLines: Map<string, TreeLine> | null = null;

      function linesOf(routes: Map<string, TreeRoute>): Map<string, TreeLine> {
        return new Map([...routes].map(([id, r]) => [id, { id, parent: r.parent, child: r.child, kind: r.kind }]));
      }

      function treeInput(): { nodes: TreeNodeInput[]; edges: TreeEdgeInput[] } {
        const hidden = hiddenNodeIds();
        const nodes: TreeNodeInput[] = [];
        cy.nodes(':childless').not(`.${CHANGE_GHOST_CLASS}`).forEach((n) => {
          if (hidden.has(n.id())) return;
          nodes.push({
            id: n.id(),
            width: n.outerWidth(),
            height: n.outerHeight(),
            group: String(n.data('group') ?? ''),
            classifier: n.data('classification') === 'Classifier',
            joiner: n.data('joiner') === 'true',
          });
        });
        const present = new Set(nodes.map(n => n.id));
        const edges: TreeEdgeInput[] = [];
        cy.edges().not(`.${CHANGE_GHOST_CLASS}, .${INHERITED_EDGE_CLASS}`).forEach((e) => {
          if (!present.has(e.source().id()) || !present.has(e.target().id())) return;
          const fwd = String(e.data('predicateFwd') ?? '');
          const rev = String(e.data('predicateRev') ?? '');
          edges.push({
            id: e.id(),
            source: e.source().id(),
            target: e.target().id(),
            identifying: e.data('identifying') === 'true',
            // Hovering the child swaps in the reverse predicate on the same run.
            label: rev.length > fwd.length ? rev : fwd,
          });
        });
        return { nodes, edges };
      }

      // The mode the on-screen positions belong to: a switch still computing has not landed.
      function positionsMode(): LayoutMode {
        return pendingRelayout?.before ?? layoutModeRef.current;
      }

      function applyEdgeRouting(): void {
        if (cy.destroyed()) return;
        const edges = cy.edges().not(`.${CHANGE_GHOST_CLASS}, .${INHERITED_EDGE_CLASS}`);
        if (positionsMode() !== 'tree') {
          treeLines = null;
          if (treeRoutes.size === 0) return;
          treeRoutes = new Map();
          edges.removeClass(TREE_EDGE_CLASSES).removeStyle(TREE_EDGE_STYLES);
          return;
        }
        const { nodes, edges: links } = treeInput();
        // Positions restored from a save or an undo: take the lines a layout of this graph would draw.
        if (treeLines === null) treeLines = linesOf(layoutTree(nodes, links).routes);
        const known = treeLines;
        const lines: TreeLine[] = links.map(e => ({
          ...(known.get(e.id) ?? { id: e.id, parent: e.source, child: e.target, kind: 'cross' }),
          label: e.label,
        }));
        const positions: PositionMap = {};
        for (const n of nodes) positions[n.id] = cy.$id(n.id).position();
        treeRoutes = routeTree(nodes, positions, lines);
        cy.batch(() => {
          edges.removeClass(TREE_EDGE_CLASSES).removeStyle(TREE_EDGE_STYLES);
          routeTreeEdges(edges);
        });
      }

      function routeTreeEdges(edges: cytoscape.EdgeCollection): void {
        edges.forEach((e) => {
          const route = treeRoutes.get(e.id());
          if (route) routeTreeEdge(e, route);
        });
      }

      const boxOf = (n: cytoscape.NodeSingular): Box =>
        ({ x: n.position('x'), y: n.position('y'), width: n.outerWidth(), height: n.outerHeight() });

      // Ends are pinned so a line leaves on its lane and enters on its row;
      // bends become segment weights and distances along source→target.
      function routeTreeEdge(edge: cytoscape.EdgeSingular, route: TreeRoute): void {
        const parentNode = cy.$id(route.parent);
        const childNode = cy.$id(route.child);
        if (parentNode.empty() || childNode.empty()) return;
        const g = routeGeometry(route, boxOf(parentNode), boxOf(childNode));
        const reversed = edge.source().id() === route.child;
        const bends = reversed ? [...g.bends].reverse() : g.bends;
        const sourceEnd = reversed ? g.childEnd : g.parentEnd;
        const targetEnd = reversed ? g.parentEnd : g.childEnd;

        const s = edge.source().position();
        const t = edge.target().position();
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1) return;
        const length = Math.sqrt(lengthSq);
        const style: Record<string, string | number> = {
          'segment-weights': bends.map(b => ((b.x - s.x) * dx + (b.y - s.y) * dy) / lengthSq).join(' '),
          'segment-distances': bends.map(b => ((b.x - s.x) * -dy + (b.y - s.y) * dx) / length).join(' '),
          'source-endpoint': `${sourceEnd.x - s.x}px ${sourceEnd.y - s.y}px`,
          'target-endpoint': `${targetEnd.x - t.x}px ${targetEnd.y - t.y}px`,
        };
        // The geometry, not the stored kind, picks the label: a cross link labels its
        // street unless its drop leaves room on the run into the child.
        edge.removeClass(TREE_EDGE_CLASSES);
        if (g.kind === 'cross' && g.labelOffset <= 0) {
          edge.addClass('tree-cross');
        } else {
          edge.addClass(reversed ? 'tree-edge tree-label-source' : 'tree-edge');
          style[reversed ? 'source-text-offset' : 'target-text-offset'] = g.labelOffset;
        }
        edge.style(style);
      }

      // ── Arrangement edits: undo/redo, select mode, hidden nodes ───────────
      let selectMode = false;

      // Hidden entities plus any joiner diamond whose members are all hidden.
      function hiddenNodeIds(): Set<string> {
        const ids = new Set(hiddenIds);
        cy.nodes('[joiner = "true"]').forEach((j) => {
          const members = j.outgoers('node');
          if (members.nonempty() && members.every(m => hiddenIds.has(m.id()))) ids.add(j.id());
        });
        return ids;
      }

      function applyHidden(): void {
        const ids = hiddenNodeIds();
        cy.nodes(`.${USER_HIDDEN_CLASS}`).removeClass(USER_HIDDEN_CLASS);
        cy.nodes().filter(n => ids.has(n.id())).unselect().addClass(USER_HIDDEN_CLASS);
      }

      let initialLayoutDone = false;
      // Reset and the mode switch asked for before the first layout lands run
      // after it, so the first layout's deep-link and restyle steps still happen.
      let queuedRelayout: { mode: LayoutMode; before: LayoutMode } | null = null;
      // A Reset or mode switch still computing; `recorded` = it pushed an undo step.
      let pendingRelayout: { before: LayoutMode; recorded: boolean } | null = null;

      // Drops a pending relayout so it never lands over an edit, leaving no
      // trace: the mode label and the undo history go back to before it.
      function cancelPendingRelayout(): boolean {
        if (pendingRelayout === null) return false;
        const { before, recorded } = pendingRelayout;
        pendingRelayout = null;
        layoutSearchGen++;
        if (layoutModeRef.current !== before) {
          layoutModeRef.current = before;
          onLayoutModeChange(before);
        }
        settleLayout();
        if (recorded) editHistoryRef.current.discardLast();
        consumePendingPanelTarget();
        reportEdits();
        return true;
      }

      // The first layout has to land before an edit means anything.
      function readyForEdit(): boolean {
        if (!initialLayoutDone) return false;
        cancelPendingRelayout();
        return true;
      }

      function snapshot(): GraphSnapshot {
        const positions: PositionMap = {};
        cy.nodes(':childless').not(`.${CHANGE_GHOST_CLASS}`).forEach((n) => {
          const p = n.position();
          positions[n.id()] = { x: p.x, y: p.y };
        });
        // While a switch computes, the positions on screen still belong to the earlier mode.
        return { positions, hidden: [...hiddenIds].sort(), mode: pendingRelayout?.before ?? layoutModeRef.current };
      }

      function persist(): void {
        const key = layoutKeyRef.current;
        if (!key || cy.destroyed()) return;
        const { positions, hidden } = snapshot();
        layoutStore.save(key, positions, hidden);
      }

      function reportEdits(): void {
        const history = editHistoryRef.current;
        onGraphEditsChange({
          canUndo: history.canUndo(),
          canRedo: history.canRedo(),
          selectMode,
          hidden: [...hiddenIds].sort(),
        });
      }

      // Focus tiers follow one pinned node; a multi-node selection pins none.
      function pinnedNode(): cytoscape.NodeSingular | null {
        const selected = cy.nodes(':selected');
        return selected.length === 1 ? selected[0] : null;
      }

      // Seat each node beside its placed neighbours, in an order that lets a
      // chain of new nodes grow out from the placed part of the graph.
      function placeNewNodes(ids: Set<string>): void {
        const pending = new Set(ids);
        const placed = () => cy.nodes(':childless:visible').filter(n => !pending.has(n.id()));
        const nextRowSlot = rowSlotsBelow(placed());
        while (pending.size > 0) {
          const waiting = cy.nodes().filter(n => pending.has(n.id()));
          const anchored = waiting.filter(n => n.neighborhood('node').some(m => !pending.has(m.id())));
          const node = anchored.nonempty() ? anchored[0] : waiting[0];
          if (!node) break;
          const anchors = node.neighborhood('node:childless:visible').filter(m => !pending.has(m.id()));
          const start = anchors.empty() ? nextRowSlot() : centroid(anchors);
          moveToClearSpot(node, start, nextRowSlot, placed());
          pending.delete(node.id());
        }
      }

      // A hidden node may have been the hovered or pinned one; its fade must go.
      function refreshFocus(): void {
        const hovered = graphHover.applied();
        if (hovered !== null && hiddenIds.has(hovered)) {
          hoveredNodeIdRef.current = null;
          graphHover.applyNow(null);
          return;
        }
        if (hovered === null) showPinnedOrClear();
      }

      function showPinnedOrClear(): void {
        const pinned = pinnedNode();
        if (pinned) {
          applyFocusTiers(pinned);
          return;
        }
        clearFocusTiers();
        redrawMarkers();
      }

      function afterArrangementEdit(): void {
        applyEdgeRouting();
        refreshFocus();
        gradeSpans();
        redrawMarkers();
        persist();
        reportEdits();
      }

      function restoreSnapshot(target: GraphSnapshot): void {
        hiddenIds = new Set(target.hidden.filter(id => entityIds.has(id)));
        applyHidden();
        applySavedPositions(cy, target.positions);
        if (target.mode !== layoutModeRef.current) {
          layoutModeRef.current = target.mode;
          onLayoutModeChange(target.mode);
        }
        // Ghosts sit against the positions that were just replaced.
        appliedReview = undefined;
        applyChangeOverlay();
        afterArrangementEdit();
      }

      function hideNodes(ids: string[]): void {
        const fresh = ids.filter(id => entityIds.has(id) && !hiddenIds.has(id));
        if (fresh.length === 0 || !readyForEdit()) return;
        editHistoryRef.current.push(snapshot());
        fresh.forEach(id => hiddenIds.add(id));
        applyHidden();
        // The pointer is still over the spot the node left, so cytoscape sends
        // no mouseout: a hover still waiting on the node is dropped here.
        if (hoveredNodeIdRef.current !== null && hiddenIds.has(hoveredNodeIdRef.current)) {
          hoveredNodeIdRef.current = null;
          graphHover.applyNow(null);
        }
        afterArrangementEdit();
      }

      function showNodes(ids: string[] | null): void {
        const back = (ids ?? [...hiddenIds]).filter(id => hiddenIds.has(id));
        if (back.length === 0 || !readyForEdit()) return;
        editHistoryRef.current.push(snapshot());
        back.forEach(id => hiddenIds.delete(id));
        applyHidden();
        // A layout that ran while they were hidden may have filled their old spots.
        placeNewNodes(new Set(back.filter(id => overlapsVisible(cy.$id(id)))));
        afterArrangementEdit();
      }

      function groupMembers(groups: string[]): string[] {
        const wanted = new Set(groups.filter(g => g !== ''));
        return modelNonNull.nodes.filter(n => wanted.has(n.group ?? '')).map(n => n.id);
      }

      function overlapsVisible(node: cytoscape.NodeSingular): boolean {
        const box = node.boundingBox();
        return cy.nodes(':childless:visible').not(node).some(other => boxesOverlap(box, other.boundingBox(), 0));
      }

      function setSelectMode(on: boolean): void {
        selectMode = on;
        // Panning off makes a plain background drag draw a selection box;
        // additive makes a click toggle a node in or out of the selection.
        cy.userPanningEnabled(!on);
        cy.selectionType(on ? 'additive' : 'single');
        reportEdits();
      }

      graphEditsRef.current = {
        undo() {
          if (!initialLayoutDone) return;
          // Undo during a pending Reset or mode switch takes back that request.
          if (cancelPendingRelayout()) return;
          if (!editHistoryRef.current.canUndo()) return;
          const previous = editHistoryRef.current.undo(snapshot());
          if (previous) restoreSnapshot(previous);
        },
        redo() {
          if (!editHistoryRef.current.canRedo() || !readyForEdit()) return;
          const next = editHistoryRef.current.redo(snapshot());
          if (next) restoreSnapshot(next);
        },
        toggleSelectMode() {
          setSelectMode(!selectMode);
        },
        hideSelection() {
          hideNodes(cy.nodes(':selected').map(n => n.id()));
        },
        showHidden(ids) {
          showNodes(ids);
        },
        hideGroups(groups) {
          hideNodes(groupMembers(groups));
        },
        showGroups(groups) {
          showNodes(groupMembers(groups));
        },
        hideSelectionGroups() {
          hideNodes(groupMembers(cy.nodes(':selected').map(n => String(n.data('group') ?? ''))));
        },
      };

      cy.on('cxttap', 'node', (evt) => {
        const node = evt.target;
        // A two-finger tap also arrives as cxttap; on a phone the edit bar is
        // hidden, so a node hidden there could never be brought back.
        if (typeof TouchEvent !== 'undefined' && evt.originalEvent instanceof TouchEvent) return;
        if (!entityIds.has(node.id())) return;
        const selected = cy.nodes(':selected');
        hideNodes(node.selected() ? selected.map(n => n.id()) : [node.id()]);
      });

      function applyChangeOverlay(): void {
        if (cy.destroyed() || !layoutSettled) return;
        const review = changeReviewRef.current;
        if (review === appliedReview) return;
        appliedReview = review;
        cy.remove(`.${CHANGE_GHOST_CLASS}`);
        cy.elements().removeData('change unexplained');
        if (review) {
          const { nodes, edges } = changeMarks(review);
          for (const [id, mark] of nodes) markElement(cy.$id(id), mark);
          for (const [id, mark] of edges) markElement(cy.$id(id), mark);
          addChangeGhosts(review, nodes, edges);
        }
        applySearchClasses();
        redrawMarkers();
        changeGlow.refresh();
      }
      applyChangeOverlayRef.current = applyChangeOverlay;

      // Tracks the last hash string we wrote ourselves, to break the hashchange feedback loop.
      let lastWrittenHash = '';

      let writeTimer: ReturnType<typeof setTimeout> | null = null;
      function scheduleHashWrite(next: HashState) {
        if (writeTimer !== null) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
          writeTimer = null;
          // Re-merge the LIVE entity= at flush time. entity= is owned by the shell
          // (modal opener/closer); a viewport write scheduled by cy.center()/pan
          // captures a snapshot eagerly, but the shell may push entity= in the
          // gap before this 200ms timer fires. Reading the hash here ensures the
          // debounced viewport write never clobbers a shell-pushed entity=.
          const liveEntity = parseHash(location.hash).entity;
          const merged: HashState = { ...next };
          if (liveEntity !== undefined) merged.entity = liveEntity;
          else delete merged.entity;
          const serialized = serializeHash(merged);
          lastWrittenHash = serialized;
          history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
        }, 200);
      }

      // Viewport (zoom/pan) writer. entity= is owned by the shell (the modal
      // opener/closer is the single writer). This carries only view/zoom/pan;
      // scheduleHashWrite re-merges the live entity= at flush time so the
      // debounced write never clobbers a shell-pushed entity=.
      function viewportState(): HashState {
        const zoom = cy.zoom();
        const pan = cy.pan();
        return {
          view: 'graph' as ViewName,
          zoom: Math.round(zoom * 1000) / 1000,
          pan: { x: Math.round(pan.x), y: Math.round(pan.y) },
        };
      }

      // Apply a hash state to the cy VIEWPORT + SELECTION only. Used on initial
      // deep-link (layoutstop) and on hashchange (Back/Forward).
      //
      // It deliberately does NOT open the entity modal. The shell is the single
      // owner of modal state: a mount effect opens the modal for an initial
      // entity= deep-link, and the useHashRoute popstate reconcile (onEntityChange)
      // opens/closes it on Back/Forward. Opening from here too would push a
      // duplicate history entry and corrupt the back-stack (the #6/#8 fight).
      function applyHashState(state: HashState) {
        if (state.zoom !== undefined) cy.zoom(state.zoom);
        if (state.pan !== undefined) cy.pan(state.pan);
        if (state.entity !== undefined) {
          const target = cy.$(`#${CSS.escape(state.entity)}`);
          if (target.length > 0) {
            showNodes([state.entity]);
            cy.elements().unselect();
            target.select();
            if (state.pan === undefined) cy.center(target);
            // Selecting an entity (deep-link / Back-Forward restore) no longer
            // draws lineage — lineage is a shift+hover affordance now. A restored
            // selection only selects the node + opens the modal (shell-owned).
          }
        } else {
          // Back/Forward to a state with no entity= → no modal. Lineage is
          // hover-driven, but clear defensively in case a hover was mid-flight.
          clearInheritedEdges();
          clearFocusTiers();
          redrawMarkers();
        }
      }

      // Completion handler for the INITIAL layout. Invoked via cy.one for the
      // preset path and via runLayout's onDone for the computed paths (the
      // two-pass fCoSE run fires layoutstop per pass, so the event can't be
      // the completion signal there).
      const onInitialLayoutDone = () => {
        initialLayoutDone = true;
        if (preloadedSaved) {
          applySavedPositions(cy, preloadedSaved);
        } else if (carried) {
          applySavedPositions(cy, carried.positions);
          placeNewNodes(new Set(cy.nodes(':childless').filter(n => carried.positions[n.id()] === undefined).map(n => n.id())));
          persist();
        } else {
          const savedKey = layoutKeyRef.current;
          const saved = savedKey ? layoutStore.load(savedKey) : null;
          if (saved) {
            applySavedPositions(cy, saved);
          }
          // (Organic local polish — arrangeOrganic — now runs inside
          // runLayout's per-candidate loop, before crossing scoring.)

          if (savedKey && !saved) persist();
        }

        settleLayout();
        gradeSpans();
        fitGraph();
        cy.style(buildStyles(modelNonNull.groups, modelNonNull.theme, themeModeRef.current));
        cy.forceRender();
        requestAnimationFrame(redrawMarkers);

        // #3 (viewer-ux-polish): the readout is the TRUE scale — cytoscape
        // zoom===1 → 100%. The initial view still fits-to-screen; on a large
        // model that reports a sub-100% percent, not a forced 100.
        onZoomPercentChange(Math.round(cy.zoom() * 100));

        window.__IGNATIUS_PERF__ = {
          layoutStopAt: performance.now(),
          nodes: cy.nodes(':childless').length,
          edges: cy.edges().length,
          layoutMode: preloadedSaved || carried ? 'preset' : 'elk',
        };

        const initialState = parseHash(location.hash);
        if (Object.keys(initialState).length > 0) {
          // Initial deep-link: restore cy viewport + node selection. The modal
          // itself is opened by the shell's mount effect (single owner).
          applyHashState(initialState);
        }
        consumePendingPanelTarget();
        reportEdits();
        if (queuedRelayout !== null) relayout(queuedRelayout.mode, queuedRelayout.before);
      };

      // A box selection should hold entities only, not the cluster frame or joiner.
      cy.nodes('[cluster = "true"], [joiner = "true"]').unselectify();
      applyHidden();
      if (preloadedSaved || carried) {
        cy.one('layoutstop', onInitialLayoutDone);
        cy.layout({ name: 'preset', fit: false } satisfies cytoscape.LayoutOptions).run();
      } else {
        runLayout(layoutModeRef.current, onInitialLayoutDone);
      }

      cy.on('viewport', () => {
        redrawMarkers();
        scheduleHashWrite(viewportState());
      });

      cy.on('zoom', () => {
        // True scale: cytoscape zoom===1 is native 1:1 → 100%.
        onZoomPercentChange(Math.round(cy.zoom() * 100));
      });

      const getViewportCenter = () => {
        const el = containerRef.current;
        if (!el) return { x: 0, y: 0 };
        return { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      };

      cyZoomInRef.current = () => {
        const step = 0.1;
        const next = cy.zoom() * (1 + step);
        const clamped = Math.min(next, cy.maxZoom());
        cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
      };

      cyZoomOutRef.current = () => {
        const step = 0.1;
        const next = cy.zoom() / (1 + step);
        const clamped = Math.max(next, cy.minZoom());
        cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
      };

      cySetPercentRef.current = (pct: number) => {
        // 100% = native 1:1 (cytoscape zoom===1). setPercent(100) → zoom 1.
        const target = pct / 100;
        const clamped = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), target));
        cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
      };

      // The branding, search bar and toggles sit over the canvas top and the footer over its bottom,
      // so a fit uses the band between them.
      function fitGraph(): void {
        const panel = containerRef.current?.getBoundingClientRect();
        const bb = cy.elements().boundingBox();
        if (!panel || bb.w <= 0 || bb.h <= 0) return;
        const bottomOf = (selector: string) =>
          Math.max(0, (document.querySelector(selector)?.getBoundingClientRect().bottom ?? panel.top) - panel.top);
        const top = Math.max(...['.branding-block', '.viewer-search-bar--graph .viewer-search-bar-inner', '.help-toggle'].map(bottomOf));
        const footer = document.querySelector('.branding-footer')?.getBoundingClientRect();
        const bottom = footer ? Math.max(0, panel.bottom - footer.top) : 0;
        const pad = 30;
        const width = cy.width() - 2 * pad;
        const height = cy.height() - top - bottom - 2 * pad;
        if (width <= 0 || height <= 0) {
          cy.fit(undefined, pad);
          return;
        }
        const zoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), width / bb.w, height / bb.h));
        // Too big even at the smallest zoom: show the top-left corner, where a Tree starts, not the middle.
        const offset = (room: number, size: number) => (size > room ? 0 : (room - size) / 2);
        cy.viewport({
          zoom,
          pan: { x: pad + offset(width, bb.w * zoom) - bb.x1 * zoom, y: top + pad + offset(height, bb.h * zoom) - bb.y1 * zoom },
        });
      }

      cyZoomResetRef.current = () => {
        // Home still fits-to-screen; the readout shows the real fit percent
        // (driven by the 'zoom' event), not a forced 100.
        fitGraph();
      };

      cy.on('position', redrawMarkers);

      // ── Inferred-upstream (inherited) edges (key-inheritance-lineage CP-B) ──
      // Ephemeral dotted edges from the selected node to each transitive 1:1
      // key-inheritance connection — the SAME set the DD spotlight shows. Added
      // AFTER layout, never fed to ELK, stripped before any fingerprint/save or
      // re-layout. Reuses the CP-A pure helper (no second inheritance compute).

      // Remove every ephemeral inherited edge. Idempotent. Called on deselect,
      // before each reselect, before any re-layout, and on teardown.
      function clearInheritedEdges(): void {
        cy.remove(`edge.${INHERITED_EDGE_CLASS}`);
      }

      // Draw the inferred-upstream edges for `selectedId`. Clears any prior set
      // first (reselect). Only connects to nodes that exist in the graph.
      function drawInheritedEdges(selectedId: string): void {
        clearInheritedEdges();
        const index = modelIndexRef.current;
        if (!index) return;
        if (cy.$(`#${CSS.escape(selectedId)}`).empty()) return;

        const additions: cytoscape.ElementDefinition[] = [];
        for (const conn of buildInheritedConnections(index, selectedId)) {
          // Only connect to nodes actually present in the graph.
          if (cy.$(`#${CSS.escape(conn.otherId)}`).empty()) continue;
          additions.push({
            data: {
              id: `${INHERITED_EDGE_PREFIX}${selectedId}__${conn.otherId}`,
              source: selectedId,
              target: conn.otherId,
              inherited: true,
            },
            classes: INHERITED_EDGE_CLASS,
          });
        }
        if (additions.length > 0) cy.add(additions);
      }

      // ── Three-tier focus opacity (key-inheritance-lineage refinement) ───────
      // While an entity is focused (selected OR hovered) elements split into
      // three visual tiers so the inherited/ancestral set reads as a middle
      // layer between full-opacity direct elements and dimmed unrelated ones:
      //   1. Direct    — focused node + its real graph neighbors + the edges
      //                  connecting them (incl. identifying lineage/descendants
      //                  and subtype joiners) → full opacity (no tier class).
      //   2. Inherited — the dotted inherited-ray edges + their endpoint nodes,
      //                  minus anything already direct → `inherited-dim` (0.5).
      //   3. Unrelated — everything else → `faded` (0.2).
      // The ray EDGES carry their 0.5 opacity from the `edge.inherited` style
      // itself, so only the inherited NODES need the `inherited-dim` class.

      // Remove every focus-tier class. Idempotent. Called before each
      // re-application (reselect / re-hover) and on mouseout / deselect.
      function clearFocusTiers(): void {
        cy.elements().removeClass('faded inherited-dim');
        cy.nodes().removeClass('hover-focus');
      }

      // Apply the three tiers around `focusNode`. The direct set reuses the
      // existing lineage-fade collection logic; the inherited set is the
      // already-drawn `edge.inherited` rays' endpoints minus the direct set.
      function applyFocusTiers(focusNode: cytoscape.NodeSingular): void {
        clearFocusTiers();

        // ── Tier 1: direct (full opacity) ──
        // Neighborhood over REAL graph edges only — the ephemeral `.inherited`
        // rays must NOT count as direct adjacency, or every inherited target
        // would be pulled into the direct tier and the middle (0.5) layer would
        // collapse. `closedNeighborhood()` follows ALL edges incl. the rays, so
        // build the direct set from the focused node's non-inherited edges.
        const realEdges = focusNode.connectedEdges().not(`.${INHERITED_EDGE_CLASS}`);
        const direct = realEdges.connectedNodes().union(focusNode);
        const joiners = direct.nodes('[joiner = "true"]');
        const lineage = collectLineage(focusNode);
        const descendants = collectDescendants(focusNode);
        const directSet = direct
          .union(realEdges)
          .union(joiners.incomers())
          .union(lineage)
          .union(descendants);
        const directWithAncestors = directSet.union(directSet.ancestors());

        // ── Tier 2: inherited (0.5) ──
        // The ephemeral inherited rays + their endpoint nodes, minus anything
        // already in the direct tier (direct wins — full opacity).
        const inheritedEdges = cy.edges(`.${INHERITED_EDGE_CLASS}`);
        const inheritedNodes = inheritedEdges
          .connectedNodes()
          .difference(directWithAncestors);
        const inheritedSet = inheritedEdges.union(inheritedNodes);
        // Keep the inherited rays + their targets out of the unrelated dim.
        const keepWithAncestors = directWithAncestors.union(inheritedSet);

        // ── Tier 3: unrelated (0.2) ──
        cy.elements().difference(keepWithAncestors).addClass('faded');
        // Inherited NODES get the 0.5 tier (edges already 0.5 via edge.inherited).
        inheritedNodes.addClass('inherited-dim');
        focusNode.addClass('hover-focus');
        redrawMarkers();
      }

      // ── Shift+hover lineage trigger (DG lineage trigger = shift+hover) ──────
      // Lineage (dotted inherited rays + 3-tier focus opacity) is revealed while
      // Shift is HELD and the pointer is over a node. A plain (no-shift) hover
      // keeps the existing direct-neighbour fade only (no inherited rays, since
      // none are drawn). `enterLineageHover` draws the rays then applies the
      // tiers; `exitLineageHover` strips both and restores normal opacity.

      function enterLineageHover(nodeId: string): void {
        const node = cy.$(`#${CSS.escape(nodeId)}`);
        if (node.empty()) return;
        drawInheritedEdges(nodeId);
        applyFocusTiers(node[0]);
        lineageActiveRef.current = true;
      }

      function exitLineageHover(): void {
        clearInheritedEdges();
        clearFocusTiers();
        lineageActiveRef.current = false;
        // Restore the plain-hover fade for the node whose hover is showing (no
        // shift), else fall back to the selected node's tiers, else clear.
        const hoveredId = graphHover.applied();
        if (hoveredId !== null) {
          const hovered = cy.$(`#${CSS.escape(hoveredId)}`);
          if (hovered.nonempty()) {
            applyFocusTiers(hovered[0]);
            return;
          }
        }
        showPinnedOrClear();
      }

      enterLineageHoverRef.current = enterLineageHover;
      exitLineageHoverRef.current = exitLineageHover;

      // ── Hover focus, applied once the pointer settles (motion.ts) ─────────
      // hoveredNodeIdRef tracks the node under the pointer right now (Shift
      // reads it); showHover renders the settled target: the node's reverse
      // predicates plus its lineage (Shift held) or direct-neighbour fade, or,
      // for null, the selected node's tiers or no fade at all.
      function showHover(nodeId: string | null): void {
        if (hoverShownId !== null) showPredicates(hoverShownId, 'fwd');
        hoverShownId = nodeId;
        if (lineageActiveRef.current) {
          clearInheritedEdges();
          clearFocusTiers();
          lineageActiveRef.current = false;
        }
        const node = nodeId === null ? cy.collection() : cy.$(`#${CSS.escape(nodeId)}`);
        if (nodeId !== null && node.nonempty()) {
          showPredicates(nodeId, 'rev');
          if (shiftHeld) enterLineageHover(nodeId);
          else applyFocusTiers(node[0]);
          return;
        }
        showPinnedOrClear();
      }

      // A hovered node's incoming edges read their reverse predicate ('rev');
      // leaving restores every connected edge to the forward one ('fwd').
      function showPredicates(nodeId: string, dir: 'fwd' | 'rev'): void {
        const n = cy.$(`#${CSS.escape(nodeId)}`);
        if (n.empty()) return;
        n.connectedEdges().forEach((edge) => {
          const verb = edge.data(dir === 'rev' ? 'predicateRev' : 'predicateFwd');
          if (verb === undefined) return;
          if (dir === 'rev' && edge.target().id() !== nodeId) return;
          edge.data('predicateMode', dir);
          edge.data('edgeLabel', applyArrow(edge, verb, dir));
        });
      }

      // Cytoscape applies tap-selection AFTER emitting 'tap', so unselecting
      // inside the tap handler is silently overridden on real pointer
      // gestures (synthetic emits don't run the gesture pipeline, which is
      // why tests missed it). Suppress the selection at the 'select' event
      // instead: armed at tapstart for non-shift gestures, disarmed after the
      // gesture's task drains — programmatic selects (deep-link restore,
      // panel navigate, entity-link hops) are never suppressed.
      let suppressTapSelect = false;
      cy.on('tapstart', 'node', (evt) => {
        suppressTapSelect = !selectMode && evt.originalEvent?.shiftKey !== true;
      });
      cy.on('tapend', () => {
        setTimeout(() => { suppressTapSelect = false; }, 0);
      });
      cy.on('select', 'node', (evt) => {
        if (suppressTapSelect) evt.target.unselect();
      });

      cy.on('tap', 'node', (evt) => {
        const nodeId = evt.target.id();
        const node = modelIndexRef.current?.nodeById.get(nodeId);
        if (!node) return;
        // SHIFT+click: pin the relationship highlight and do NOT open the
        // modal. cy's tap-select is allowed through (shift gesture), and the
        // mouseout/mouseleave handlers re-apply the selected node's focus
        // tiers — the neighbourhood stays lit until deselect/background tap.
        if (evt.originalEvent?.shiftKey) return;
        // Plain click: open the modal ONLY — nothing stays highlighted. The
        // modal covers the canvas, so cytoscape never gets the mouseout that
        // would clear the hover fade; clear ALL highlight state here instead
        // of relying on it (the tap-select itself is suppressed above).
        //
        // Shell's onSelectEntity is the single writer of entity= (pushes one
        // history entry). GraphView does not write entity= on tap. Lineage
        // (dotted inherited rays + 3-tier focus opacity) is a shift+hover
        // affordance (see showHover).
        // Select mode: a click toggles the node in the selection instead.
        if (selectMode) return;
        hoveredNodeIdRef.current = null;
        graphHover.applyNow(null);
        clearInheritedEdges();
        clearFocusTiers();
        lineageActiveRef.current = false;
        redrawMarkers();
        onSelectEntity(node);
      });

      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          // Shell's onDeselectEntity clears entity= (replaceState). GraphView
          // does not write the hash here — the shell owns entity= lifecycle.
          clearInheritedEdges();
          clearFocusTiers();
          lineageActiveRef.current = false;
          redrawMarkers();
          onDeselectEntity();
        }
      });

      // Pan+select for an entity link/navigation. The shell pushes entity= via
      // openEntity before calling this; GraphView only moves the viewport.
      // Selecting (navigation) does NOT draw lineage — lineage is shift+hover.
      navigateToEntityRef.current = (id: string) => {
        const target = cy.$(`#${CSS.escape(id)}`);
        if (target.length === 0) return;
        showNodes([id]);
        cy.elements().unselect();
        target.select();
        cy.center(target);
      };

      let saveTimer: ReturnType<typeof setTimeout> | null = null;

      // `before` is the mode the undo step returns to.
      function relayout(mode: LayoutMode, before: LayoutMode = mode): void {
        if (!initialLayoutDone) {
          queuedRelayout = { mode, before: queuedRelayout?.before ?? before };
          return;
        }
        queuedRelayout = null;
        if (saveTimer !== null) clearTimeout(saveTimer);
        // Strip ephemeral inherited edges BEFORE re-layout so ELK never lays
        // them out and the saved ELK position set never captures them. Also
        // clear focus tiers so the relaid-out graph returns to full opacity.
        clearInheritedEdges();
        clearFocusTiers();
        lineageActiveRef.current = false;
        // A second request while one is pending replaces it; the undo step
        // and the mode to return to stay those of the first.
        const recorded = pendingRelayout?.recorded ?? layoutSettled;
        const firstBefore = pendingRelayout?.before ?? before;
        if (pendingRelayout === null && layoutSettled) editHistoryRef.current.push({ ...snapshot(), mode: before });
        pendingRelayout = { before: firstBefore, recorded };
        reportEdits();
        unsettleLayout();
        runLayout(mode, () => {
          pendingRelayout = null;
          settleLayout();
          gradeSpans();
          fitGraph();
          redrawMarkers();
          persist();
          reportEdits();
          consumePendingPanelTarget();
          // fit fires a 'zoom' event → readout updates to the real percent.
        });
      }

      resetLayoutRef.current = () => relayout(layoutModeRef.current);
      applyLayoutModeRef.current = (mode, before) => relayout(mode, before);

      panelNavigateRef.current = (id: string) => {
        if (layoutSettled) panelNavigate(id);
        else pendingPanelTarget = id;
      };

      function consumePendingPanelTarget(): void {
        if (pendingPanelTarget === null) return;
        const id = pendingPanelTarget;
        pendingPanelTarget = null;
        panelNavigate(id);
      }

      function panelNavigate(id: string): void {
        const target = cy.$(`#${CSS.escape(id)}`);
        if (target.length === 0) return;
        showNodes([id]);
        cy.elements().unselect();
        target.select();
        cy.center(target);
        // Panel-navigate selects+centers but does NOT draw lineage (shift+hover).
        const node = modelIndexRef.current?.nodeById.get(id);
        if (node) onPanelSelect(node);
        // Panel-navigate selects+centers but does NOT open the modal, so it must
        // not set entity= (which means "modal open"). viewportState preserves any
        // entity= already in the hash; the center() above triggers a viewport
        // write of its own, so no explicit hash write is needed here.
      }

      function onHashChange() {
        const newHash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
        if (newHash === lastWrittenHash) return;
        lastWrittenHash = newHash;
        applyHashState(parseHash(location.hash));
      }
      window.addEventListener('hashchange', onHashChange);

      // ── Pinch-zoom page-zoom guard (viewer-ux-polish #4) ──────────────────
      // Trackpad pinch arrives as a wheel event with ctrlKey===true (and Cmd on
      // some platforms metaKey). The browser's default for ctrl+wheel is to
      // PAGE-zoom, which scrolls the viewer chrome out of view. Cytoscape's own
      // wheel handler zooms the canvas, but it does NOT call preventDefault, so
      // the page zooms too. A native NON-PASSIVE listener is required: React's
      // synthetic onWheel is registered passive at the root, so preventDefault
      // there is ignored. We only block the page-zoom default — cytoscape's
      // listener still receives the event and zooms the canvas (verified: both
      // listeners fire; preventDefault stops only the browser default, not
      // sibling listeners).
      const wheelContainer = containerRef.current;
      function blockPageZoom(ev: WheelEvent) {
        if (ev.ctrlKey || ev.metaKey) ev.preventDefault();
      }
      wheelContainer?.addEventListener('wheel', blockPageZoom, { passive: false });

      // ── Shift keydown/keyup → toggle lineage on the hovered node ───────────
      // The mouseover handler only sees the shift state AT pointer-enter time.
      // To handle holding/releasing Shift WHILE already hovering a node, listen
      // for the Shift key globally: pressing Shift over a hovered node enters
      // lineage mode; releasing Shift exits it. Both read live state from refs to
      // avoid stale closures. Listeners are removed in the cy-init cleanup.
      // Pressing Shift is a deliberate request, so it skips the hover wait:
      // a node still inside its settle window shows its lineage at once.
      function onShiftKeyDown(ev: KeyboardEvent) {
        if (ev.key !== 'Shift') return;
        shiftHeld = true;
        if (lineageActiveRef.current) return; // already showing lineage
        const hoveredId = hoveredNodeIdRef.current;
        if (hoveredId === null) return; // not over a node
        if (graphHover.applied() === hoveredId) enterLineageHoverRef.current?.(hoveredId);
        else graphHover.applyNow(hoveredId);
      }
      function onShiftKeyUp(ev: KeyboardEvent) {
        if (ev.key !== 'Shift') return;
        shiftHeld = false;
        if (!lineageActiveRef.current) return;
        exitLineageHoverRef.current?.();
      }
      document.addEventListener('keydown', onShiftKeyDown);
      document.addEventListener('keyup', onShiftKeyUp);

      function applyArrow(edge: cytoscape.EdgeSingular, verb: string, dir: 'fwd' | 'rev'): string {
        if (!verb) return '';
        const s = edge.sourceEndpoint();
        const t = edge.targetEndpoint();
        if (!s || !t || !Number.isFinite(s.x) || !Number.isFinite(t.x)) {
          return dir === 'fwd' ? `${verb} →` : `← ${verb}`;
        }
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const flipped = dx < 0;
        if (dir === 'fwd') return flipped ? `← ${verb}` : `${verb} →`;
        const result = flipped ? `${verb} →` : `← ${verb}`;
        void dy;
        return result;
      }

      function refreshArrows() {
        cy.edges().forEach((edge) => {
          const fwd = edge.data('predicateFwd');
          if (fwd === undefined) return;
          const mode = edge.data('predicateMode') as 'fwd' | 'rev' | undefined;
          if (mode === 'rev') {
            const rev = edge.data('predicateRev');
            edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
          } else {
            edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
          }
        });
      }

      cy.on('layoutstop', refreshArrows);
      cy.on('position', 'node', (evt) => {
        if (treeRoutes.size === 0) return;
        routeTreeEdges(evt.target.connectedEdges());
      });
      cy.on('position', 'node', refreshArrows);
      cy.on('drag', 'node', refreshArrows);
      cy.on('free', 'node', refreshArrows);
      setTimeout(refreshArrows, 0);

      // A selection drag grabs and frees every selected node: snapshot at the
      // first grab, record once at the first free, only if something moved.
      let dragBefore: GraphSnapshot | null = null;
      // mousedown alone fires grab, so a click must not cancel a pending layout.
      cy.on('grab', 'node', () => {
        if (dragBefore === null && initialLayoutDone) dragBefore = snapshot();
      });

      cy.on('free', 'node', () => {
        // Re-grade edge spans on drag release — a moved node changes which of
        // its edges count as long-haul.
        gradeSpans();
        if (dragBefore !== null) {
          const before = dragBefore;
          dragBefore = null;
          const moved = cy.nodes(':childless').some((n) => {
            const was = before.positions[n.id()];
            return was !== undefined && Math.hypot(was.x - n.position('x'), was.y - n.position('y')) > 0.5;
          });
          if (moved) {
            readyForEdit();
            editHistoryRef.current.push(before);
            reportEdits();
            // Once per gesture: every node of a dragged selection fires its own free.
            if (positionsMode() === 'tree') applyEdgeRouting();
          }
        }
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
      });

      function collectLineage(start: cytoscape.NodeCollection) {
        let acc = cy.collection();
        let frontier = start;
        const seen = new Set<string>([start.id()]);
        while (frontier.nonempty()) {
          const inEdges = frontier.incomers('edge[identifying = "true"]');
          if (inEdges.empty()) break;
          const parents = inEdges.sources();
          acc = acc.union(inEdges).union(parents);
          frontier = parents.filter((p) => {
            if (seen.has(p.id())) return false;
            seen.add(p.id());
            return true;
          });
        }
        return acc;
      }

      function collectDescendants(start: cytoscape.NodeCollection) {
        let acc = cy.collection();
        let frontier = start;
        const seen = new Set<string>([start.id()]);
        while (frontier.nonempty()) {
          const outEdges = frontier.outgoers('edge[identifying = "true"]');
          if (outEdges.empty()) break;
          const children = outEdges.targets();
          acc = acc.union(outEdges).union(children);
          frontier = children.filter((c) => {
            if (seen.has(c.id())) return false;
            seen.add(c.id());
            return true;
          });
        }
        return acc;
      }

      cy.on('mouseover', 'node', (evt) => {
        const id = evt.target.id();
        hoveredNodeIdRef.current = id;
        shiftHeld = evt.originalEvent?.shiftKey === true;
        graphHover.set(id);
      });

      cy.on('mouseout', 'node', (evt) => {
        if (hoveredNodeIdRef.current === evt.target.id()) hoveredNodeIdRef.current = null;
        graphHover.set(null);
      });

      // Cytoscape only synthesises a node `mouseout` from mousemoves on its own
      // canvas — a pointer that EXITS the canvas from on top of a node (into
      // the entity modal, the top bar, off-window) never gets one, so the
      // hover fade stuck permanently. Clear hover state at the DOM boundary:
      // leaving the graph container ends the hover; a shift+click-pinned
      // selection re-applies its tiers instead (the pin must survive).
      const onGraphMouseLeave = () => {
        hoveredNodeIdRef.current = null;
        graphHover.set(null);
      };
      containerRef.current.addEventListener('mouseleave', onGraphMouseLeave);

      cyRef.current = cy;

      // Mount navigator INSIDE the cy lifecycle so teardown is guaranteed before cy.destroy().
      if (minimapOpenRef.current && minimapRef.current) {
        navRef.current = mountNavigator(cy);
      }

      setCyReady(true);
      onCyReadyChange(true);

      return () => {
        if (navRef.current) {
          teardownNavigator(navRef.current, minimapRef.current);
          navRef.current = null;
        }
        if (writeTimer !== null) clearTimeout(writeTimer);
        if (saveTimer !== null) clearTimeout(saveTimer);
        graphHover.cancel();
        window.removeEventListener('hashchange', onHashChange);
        wheelContainer?.removeEventListener('wheel', blockPageZoom);
        document.removeEventListener('keydown', onShiftKeyDown);
        document.removeEventListener('keyup', onShiftKeyUp);
        containerRef.current?.removeEventListener('mouseleave', onGraphMouseLeave);
        navigateToEntityRef.current = () => {};
        panelNavigateRef.current = () => {};
        resetLayoutRef.current = null;
        applyLayoutModeRef.current = null;
        graphEditsRef.current = null;
        redrawMarkersRef.current = null;
        applySearchClassesRef.current = null;
        applyChangeOverlayRef.current = null;
        cyZoomInRef.current = null;
        cyZoomOutRef.current = null;
        cySetPercentRef.current = null;
        cyZoomResetRef.current = null;
        enterLineageHoverRef.current = null;
        exitLineageHoverRef.current = null;
        hoveredNodeIdRef.current = null;
        lineageActiveRef.current = false;
        // Strip ephemeral inherited edges + focus tiers on teardown / view-switch
        // away. cy.destroy() below also drops them, but clearing first keeps the
        // no-leak intent explicit.
        clearInheritedEdges();
        clearFocusTiers();
        changeGlow.destroy();
        cy.destroy();
        cyRef.current = null;
        window.__IGNATIUS_CY__ = undefined;
        setCyReady(false);
        onCyReadyChange(false);
        if (svgRef.current) {
          svgRef.current.remove();
          svgRef.current = null;
        }
      };
    }, [model, isActive]); // eslint-disable-line react-hooks/exhaustive-deps
    // Note: themeMode intentionally excluded — retheme is handled by the shell calling handle.retheme().
    // onSelectEntity, onDeselectEntity, onZoomPercentChange, onCyReadyChange, onCyInitError are stable callbacks.

    // GraphView renders nothing — the cy canvas is mounted imperatively into containerRef.
    return null;
  },
);
