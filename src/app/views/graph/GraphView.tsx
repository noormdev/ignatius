import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import cytoscape from 'cytoscape';
import {
  fanSubtypeClusters,
  deoverlapNodes,
  separateClusterFans,
  separateLeafFan,
  decollinearNodes,
  arrangeOrganic,
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
import type { Model, ModelNode, ModelEdge, SubtypeCluster } from '../../../model/parse';
import type { EntityError, GlobalError } from '../../../model/validate';
import type { ModelIndex } from '../../../model/model-index';

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

    // minimapOpenRef: read by cy effect on mount (avoid adding minimapOpen to deps).
    const minimapOpenRef = useRef<boolean>(minimapOpen);
    minimapOpenRef.current = minimapOpen;

    // Layout mode — seeded from initialLayoutMode; only mutated internally.
    const layoutModeRef = useRef<LayoutMode>(initialLayoutMode);

    // Zoom baseline: cy.zoom() at last cy.fit(); anchors 100% to fit, not cy==1.
    const zoomBaselineRef = useRef<number>(1);

    // Refs wired inside cy-init so the handle can call them outside the closure.
    const navigateToEntityRef = useRef<(id: string) => void>(() => {});
    const panelNavigateRef = useRef<(id: string) => void>(() => {});
    const resetLayoutRef = useRef<(() => void) | null>(null);
    const applyLayoutModeRef = useRef<((mode: LayoutMode) => void) | null>(null);
    // Wired inside cy-init to the local redrawMarkers closure (clears + redraws badges).
    const redrawMarkersRef = useRef<(() => void) | null>(null);
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

      function effectiveAlgorithm(mode: LayoutMode): 'stress' | 'layered' {
        if (mode === 'organic' && entityCount >= ORGANIC_FALLBACK_THRESHOLD) return 'layered';
        return mode === 'organic' ? 'stress' : 'layered';
      }

      const buildLayoutOpts = (mode: LayoutMode): cytoscape.LayoutOptions => {
        const algo = effectiveAlgorithm(mode);
        if (algo === 'stress') {
          const stressIterLimit =
            entityCount < 50  ? undefined :
            entityCount < 100 ? 150 :
                                80;
          return {
            name: 'elk',
            elk: {
              algorithm: 'stress',
              'elk.stress.desiredEdgeLength': String(Math.max(280, Math.round(layerSpacing * 1.6))),
              'elk.spacing.nodeNode': String(Math.max(120, model.theme.spacing.nodeSep)),
              'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
              ...(stressIterLimit !== undefined
                ? { 'elk.stress.iterationLimit': String(stressIterLimit) }
                : {}),
            },
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

      const elkLayoutOpts = buildLayoutOpts(layoutModeRef.current);

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

      // Use null layout during construction so the layoutstop handler is always
      // attached before the layout fires (preset fires layoutstop synchronously).
      const nullLayoutOpts = { name: 'null' } satisfies cytoscape.LayoutOptions;
      const chosenLayout = preloadedSaved ? nullLayoutOpts : elkLayoutOpts;

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
          }
        }
      }

      cy.one('layoutstop', () => {
        if (preloadedSaved) {
          applySavedPositions(cy, preloadedSaved);
        } else {
          const savedKey = layoutKeyRef.current;
          const saved = savedKey ? layoutStore.load(savedKey) : null;
          if (saved) {
            applySavedPositions(cy, saved);
          } else if (layoutModeRef.current === 'organic' && entityCount < ORGANIC_FALLBACK_THRESHOLD) {
            arrangeOrganic(cy, organicIters(entityCount));
          }

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

        cy.fit(undefined, 30);
        cy.style(buildStyles(modelNonNull.groups, modelNonNull.theme, themeModeRef.current));
        cy.forceRender();
        requestAnimationFrame(redrawMarkers);

        zoomBaselineRef.current = cy.zoom();
        onZoomPercentChange(100);

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
      });

      if (preloadedSaved) {
        cy.layout({ name: 'preset', fit: false } satisfies cytoscape.LayoutOptions).run();
      }

      cy.on('viewport', () => {
        redrawMarkers();
        scheduleHashWrite(viewportState());
      });

      cy.on('zoom', () => {
        const baseline = zoomBaselineRef.current;
        if (baseline > 0) {
          onZoomPercentChange(Math.round(cy.zoom() / baseline * 100));
        }
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
        const target = zoomBaselineRef.current * (pct / 100);
        const clamped = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), target));
        cy.zoom({ level: clamped, renderedPosition: getViewportCenter() });
      };

      cyZoomResetRef.current = () => {
        cy.fit(undefined, 30);
        zoomBaselineRef.current = cy.zoom();
        onZoomPercentChange(100);
      };

      cy.on('position', redrawMarkers);

      cy.on('tap', 'node', (evt) => {
        const nodeId = evt.target.id();
        const node = modelIndexRef.current?.nodeById.get(nodeId);
        if (node) {
          // Shell's onSelectEntity is the single writer of entity= (pushes one
          // history entry). GraphView does not write entity= on tap.
          onSelectEntity(node);
        }
      });

      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          // Shell's onDeselectEntity clears entity= (replaceState). GraphView
          // does not write the hash here — the shell owns entity= lifecycle.
          onDeselectEntity();
        }
      });

      // Pan+select for an entity link/navigation. The shell pushes entity= via
      // openEntity before calling this; GraphView only moves the viewport.
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
        layoutStore.clear(layoutKeyRef.current);
        const mode = layoutModeRef.current;
        const lo = cy.layout(buildLayoutOpts(mode));
        lo.one('layoutstop', () => {
          if (mode === 'organic' && entityCount < ORGANIC_FALLBACK_THRESHOLD) {
            arrangeOrganic(cy, organicIters(entityCount));
          }
          cy.fit(undefined, 30);
          redrawMarkers();
          zoomBaselineRef.current = cy.zoom();
          onZoomPercentChange(100);
        });
        lo.run();
      };

      applyLayoutModeRef.current = (mode) => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        const lo = cy.layout(buildLayoutOpts(mode));
        lo.one('layoutstop', () => {
          if (mode === 'organic' && entityCount < ORGANIC_FALLBACK_THRESHOLD) {
            arrangeOrganic(cy, organicIters(entityCount));
          }
          cy.fit(undefined, 30);
          redrawMarkers();
          zoomBaselineRef.current = cy.zoom();
          onZoomPercentChange(100);
        });
        lo.run();
      };

      panelNavigateRef.current = (id: string) => {
        const target = cy.$(`#${CSS.escape(id)}`);
        if (target.length === 0) return;
        cy.elements().unselect();
        target.select();
        cy.center(target);
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
        const direct = n.closedNeighborhood().union(n);
        const joiners = direct.nodes('[joiner = "true"]');
        const lineage = collectLineage(n);
        const descendants = collectDescendants(n);
        const keep = direct.union(joiners.incomers()).union(lineage).union(descendants);
        const keepWithAncestors = keep.union(keep.ancestors());
        cy.elements().difference(keepWithAncestors).addClass('faded');
        n.addClass('hover-focus');
        redrawMarkers();
      });

      cy.on('mouseout', 'node', (evt) => {
        const n = evt.target;
        n.connectedEdges().forEach((edge) => {
          const fwd = edge.data('predicateFwd');
          if (fwd === undefined) return;
          edge.data('predicateMode', 'fwd');
          edge.data('edgeLabel', applyArrow(edge, fwd, 'fwd'));
        });
        cy.elements().removeClass('faded');
        cy.nodes().removeClass('hover-focus');
        redrawMarkers();
      });

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
        navigateToEntityRef.current = () => {};
        panelNavigateRef.current = () => {};
        resetLayoutRef.current = null;
        applyLayoutModeRef.current = null;
        redrawMarkersRef.current = null;
        cyZoomInRef.current = null;
        cyZoomOutRef.current = null;
        cySetPercentRef.current = null;
        cyZoomResetRef.current = null;
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
