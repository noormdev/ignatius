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
import { createMarkerOverlay, updateMarkers, drawWarningBadges } from './markers';
import { wrapEntityLabel } from './wrap-label';
import { createLayoutStore } from './layout-store';
import type { PositionMap } from './layout-store';
import { parseHash, serializeHash } from '../../hash-router';
import type { HashState, ViewName } from '../../hash-router';
import { buildInheritedConnections } from '../../logic/spotlight-inherited';
import type { Model, ModelNode, ModelEdge, SubtypeCluster } from '../../../model/parse';
import type { EntityError, GlobalError } from '../../../model/validate';
import type { ModelIndex } from '../../../model/model-index';

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

// ---------------------------------------------------------------------------
// LayoutMode — graph-only concept, exported so App shell can read/display it.
// ---------------------------------------------------------------------------

export type LayoutMode = 'hierarchical' | 'organic';

// ---------------------------------------------------------------------------
// GraphViewHandle — shell↔view typed contract.
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed by GraphView to the shell (App). The shell calls
 * into the view for actions that originate outside the cy surface:
 * - `navigateToEntity`: entity modal link → pan+select in cy + hash write.
 * - `panelNavigate`:    findings panel row → pan+center+select in cy.
 * - `resetLayout`:      FAB "Reset layout" action.
 * - `applyLayoutMode`:  FAB layout-mode toggle → re-run ELK in new mode.
 * - zoom ops:           ZoomControl wiring.
 * - `retheme`:          theme-mode change → restyle cy without rebuild.
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
  retheme(mode: 'dark' | 'light', model: Model, entityErrors: EntityError[]): void;
}

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
      onCyReadyChange,
      onZoomPercentChange,
      onLayoutModeChange,
      onCyInitError,
      onSelectEntity,
      onDeselectEntity,
      onPanelSelect,
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

    // minimapOpenRef: read by cy effect on mount (avoid adding minimapOpen to deps).
    const minimapOpenRef = useRef<boolean>(minimapOpen);
    minimapOpenRef.current = minimapOpen;

    // Layout mode — seeded from initialLayoutMode; only mutated internally.
    const layoutModeRef = useRef<LayoutMode>(initialLayoutMode);

    // Refs wired inside cy-init so the handle can call them outside the closure.
    const navigateToEntityRef = useRef<(id: string) => void>(() => {});
    const panelNavigateRef = useRef<(id: string) => void>(() => {});
    const resetLayoutRef = useRef<(() => void) | null>(null);
    const applyLayoutModeRef = useRef<((mode: LayoutMode) => void) | null>(null);

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
        layoutModeRef.current = mode;
        applyLayoutModeRef.current?.(mode);
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
        const el: cytoscape.ElementDefinition = {
          data: {
            id: node.id,
            label: wrapEntityLabel(node.id),
            classification: node.classification,
            group: node.group ?? '',
          },
        };
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
        if (subtypeEdgeKeys.has(`${edge.source}-${edge.target}`)) continue;

        elements.push({
          data: {
            id: `${edge.source}-${edge.target}`,
            source: edge.target,
            target: edge.source,
            identifying: String(edge.identifying),
            predicateFwd: edge.predicate.fwd,
            predicateRev: edge.predicate.rev,
            edgeLabel: edge.predicate.fwd,
            predicateMode: 'fwd',
            parentCard: edge.cardinality.parent,
            childCard: edge.cardinality.child,
          },
        });
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

      function effectiveAlgorithm(mode: LayoutMode): 'fcose' | 'layered' {
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
        if (effectiveAlgorithm(m) !== 'fcose') {
          cy.one('layoutstop', onDone);
          cy.layout(buildLayoutOpts(m)).run();
          return;
        }
        // The search runs on a HEADLESS scratch mirror of the graph: once the
        // live core has painted, every element read/write pays renderer
        // bookkeeping (label re-measures, compound bounds, notify) — measured
        // at seconds per candidate versus milliseconds headless. The live
        // graph keeps its current picture until the winner is applied.
        // Above ~150 entities the flat force problem starts to tangle —
        // decompose by colour family via compound regions on the mirror.
        const scratch = buildScratchCore(cy, entityCount >= 150);
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
        if (preloadedSaved) {
          applySavedPositions(cy, preloadedSaved);
        } else {
          const savedKey = layoutKeyRef.current;
          const saved = savedKey ? layoutStore.load(savedKey) : null;
          if (saved) {
            applySavedPositions(cy, saved);
          }
          // (Organic local polish — arrangeOrganic — now runs inside
          // runLayout's per-candidate loop, before crossing scoring.)

          if (savedKey && !saved) {
            const elkPositions: Record<string, { x: number; y: number }> = {};
            cy.nodes().forEach((node) => {
              if (node.isParent()) return;
              const pos = node.position();
              elkPositions[node.id()] = { x: pos.x, y: pos.y };
            });
            layoutStore.save(savedKey, elkPositions);
          }
        }

        gradeEdgeSpans(cy);
        cy.fit(undefined, 30);
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
          layoutMode: preloadedSaved ? 'preset' : 'elk',
        };

        const initialState = parseHash(location.hash);
        if (Object.keys(initialState).length > 0) {
          // Initial deep-link: restore cy viewport + node selection. The modal
          // itself is opened by the shell's mount effect (single owner).
          applyHashState(initialState);
        }
      };

      if (preloadedSaved) {
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

      cyZoomResetRef.current = () => {
        // Home still fits-to-screen; the readout shows the real fit percent
        // (driven by the 'zoom' event), not a forced 100.
        cy.fit(undefined, 30);
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
        // Restore the plain-hover fade if still hovering a node (no shift), else
        // fall back to the selected node's tiers, else clear to normal.
        const hoveredId = hoveredNodeIdRef.current;
        if (hoveredId !== null) {
          const hovered = cy.$(`#${CSS.escape(hoveredId)}`);
          if (hovered.nonempty()) {
            applyFocusTiers(hovered[0]);
            return;
          }
        }
        const selected = cy.nodes(':selected');
        if (selected.nonempty()) {
          applyFocusTiers(selected[0]);
        } else {
          redrawMarkers();
        }
      }

      enterLineageHoverRef.current = enterLineageHover;
      exitLineageHoverRef.current = exitLineageHover;

      // Cytoscape applies tap-selection AFTER emitting 'tap', so unselecting
      // inside the tap handler is silently overridden on real pointer
      // gestures (synthetic emits don't run the gesture pipeline, which is
      // why tests missed it). Suppress the selection at the 'select' event
      // instead: armed at tapstart for non-shift gestures, disarmed after the
      // gesture's task drains — programmatic selects (deep-link restore,
      // panel navigate, entity-link hops) are never suppressed.
      let suppressTapSelect = false;
      cy.on('tapstart', 'node', (evt) => {
        suppressTapSelect = evt.originalEvent?.shiftKey !== true;
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
        // affordance (see the mouseover handler below).
        hoveredNodeIdRef.current = null;
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
        cy.elements().unselect();
        target.select();
        cy.center(target);
      };

      let saveTimer: ReturnType<typeof setTimeout> | null = null;

      resetLayoutRef.current = () => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        // Strip ephemeral inherited edges BEFORE re-layout so ELK never lays
        // them out and the saved ELK position set never captures them. Also
        // clear focus tiers so the relaid-out graph returns to full opacity.
        clearInheritedEdges();
        clearFocusTiers();
        lineageActiveRef.current = false;
        layoutStore.clear(layoutKeyRef.current);
        runLayout(layoutModeRef.current, () => {
          gradeEdgeSpans(cy);
          cy.fit(undefined, 30);
          redrawMarkers();
          // fit fires a 'zoom' event → readout updates to the real percent.
        });
      };

      applyLayoutModeRef.current = (mode) => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        // Strip ephemeral inherited edges BEFORE re-layout (never fed to ELK).
        // Also clear focus tiers so the relaid-out graph returns to full opacity.
        clearInheritedEdges();
        clearFocusTiers();
        lineageActiveRef.current = false;
        runLayout(mode, () => {
          gradeEdgeSpans(cy);
          cy.fit(undefined, 30);
          redrawMarkers();
          // fit fires a 'zoom' event → readout updates to the real percent.
        });
      };

      panelNavigateRef.current = (id: string) => {
        const target = cy.$(`#${CSS.escape(id)}`);
        if (target.length === 0) return;
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
      };

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
      function onShiftKeyDown(ev: KeyboardEvent) {
        if (ev.key !== 'Shift') return;
        if (lineageActiveRef.current) return; // already showing lineage
        const hoveredId = hoveredNodeIdRef.current;
        if (hoveredId === null) return; // not over a node
        enterLineageHoverRef.current?.(hoveredId);
      }
      function onShiftKeyUp(ev: KeyboardEvent) {
        if (ev.key !== 'Shift') return;
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
      cy.on('position', 'node', refreshArrows);
      cy.on('drag', 'node', refreshArrows);
      cy.on('free', 'node', refreshArrows);
      setTimeout(refreshArrows, 0);

      cy.on('free', 'node', () => {
        // Re-grade edge spans on drag release — a moved node changes which of
        // its edges count as long-haul.
        gradeEdgeSpans(cy);
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const key = layoutKeyRef.current;
          if (!key) return;
          const positions: Record<string, { x: number; y: number }> = {};
          cy.nodes().forEach((node) => {
            const pos = node.position();
            positions[node.id()] = { x: pos.x, y: pos.y };
          });
          layoutStore.save(key, positions);
        }, 400);
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
        const n = evt.target;
        n.connectedEdges().forEach((edge) => {
          const rev = edge.data('predicateRev');
          if (rev === undefined) return;
          if (edge.target().id() === n.id()) {
            edge.data('predicateMode', 'rev');
            edge.data('edgeLabel', applyArrow(edge, rev, 'rev'));
          }
        });
        // Track the hovered node so the document-level Shift keydown/keyup
        // listeners know which node to reveal lineage for.
        hoveredNodeIdRef.current = n.id();

        // Shift held → LINEAGE mode: draw the dotted inherited rays + apply the
        // 3-tier focus opacity. No shift → plain direct-neighbour fade only (no
        // rays are drawn, so applyFocusTiers degrades to the direct/unrelated
        // two-tier fade — the pre-existing hover behaviour).
        const shiftHeld = evt.originalEvent?.shiftKey === true;
        if (shiftHeld) {
          enterLineageHover(n.id());
        } else {
          applyFocusTiers(n);
        }
      });

      cy.on('mouseout', 'node', (evt) => {
        const n = evt.target;
        n.connectedEdges().forEach((edge) => {
          const fwd = edge.data('predicateFwd');
          if (fwd === undefined) return;
          edge.data('predicateMode', 'fwd');
          edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
        });
        // Leaving the node clears the hovered id first so exitLineageHover does
        // not try to re-apply a fade for a node we're no longer over.
        if (hoveredNodeIdRef.current === n.id()) hoveredNodeIdRef.current = null;

        // In lineage mode (shift+hover), exit: strip the rays + focus tiers.
        if (lineageActiveRef.current) {
          clearInheritedEdges();
          clearFocusTiers();
          lineageActiveRef.current = false;
        }
        // Fall back to the SELECTED node's tiers if one is selected (so leaving a
        // hovered node doesn't kill the select-state hierarchy); otherwise clear
        // back to normal (all full opacity).
        const selected = cy.nodes(':selected');
        if (selected.nonempty()) {
          applyFocusTiers(selected[0]);
        } else {
          clearFocusTiers();
          redrawMarkers();
        }
      });

      // Cytoscape only synthesises a node `mouseout` from mousemoves on its own
      // canvas — a pointer that EXITS the canvas from on top of a node (into
      // the entity modal, the top bar, off-window) never gets one, so the
      // hover fade stuck permanently. Clear hover state at the DOM boundary:
      // leaving the graph container ends the hover; a shift+click-pinned
      // selection re-applies its tiers instead (the pin must survive).
      const onGraphMouseLeave = () => {
        hoveredNodeIdRef.current = null;
        if (lineageActiveRef.current) {
          clearInheritedEdges();
          lineageActiveRef.current = false;
        }
        const selected = cy.nodes(':selected');
        if (selected.nonempty()) {
          applyFocusTiers(selected[0]);
        } else {
          clearFocusTiers();
          redrawMarkers();
        }
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
        window.removeEventListener('hashchange', onHashChange);
        wheelContainer?.removeEventListener('wheel', blockPageZoom);
        document.removeEventListener('keydown', onShiftKeyDown);
        document.removeEventListener('keyup', onShiftKeyUp);
        containerRef.current?.removeEventListener('mouseleave', onGraphMouseLeave);
        navigateToEntityRef.current = () => {};
        panelNavigateRef.current = () => {};
        resetLayoutRef.current = null;
        applyLayoutModeRef.current = null;
        redrawMarkersRef.current = null;
        applySearchClassesRef.current = null;
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
