import { useEffect, useRef, useState, createElement, forwardRef, useImperativeHandle } from 'react';
import type { Root as ReactRoot } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { FlowDiagramSvg } from '../../../flow-view/FlowDiagramSvg';
import type { MinimapData, FlowDiagramSvgProps } from '../../../flow-view/FlowDiagramSvg';
import { FlowChrome } from '../../../flow-view/FlowChrome';
import type { FlowChromeHandle, BreadcrumbEntry } from '../../../flow-view/FlowChrome';
import { FlowNodeModal } from '../../components/flow-node/FlowNodeModal';
import { FlowDocModal } from '../../components/flow-node/FlowDocModal';
import { resolveFlowKindPalette } from '../../../theme/theme-defaults';
import type { ThemeConfig } from '../../../theme/theme-defaults';
import { createLayoutStore } from '../graph/layout-store';
import type { PositionMap } from '../graph/layout-store';
import { buildAllFlowNodeIds } from '../../logic/flow-node-ids';
import { buildFlowDocResolver } from '../../logic/doc-resolver';
import { splitDocToken } from '../../logic/doc-resolver';
import type { FlowDoc, FlowDocResult } from '../../logic/doc-resolver';
import { buildFlowNodeUsageIndex } from '../../../flows/flow-usage-index';
import { computeElkLayout } from '../../../flow-view/elk-flow-layout';
import { screenScaleToPercent, percentToScreenScale } from '../../../flow-view/zoom-scale';
import type { ElkPositionMap } from '../../../flow-view/FlowDiagramSvg';
import { parseHash, serializeHash } from '../../hash-router';
import type { HashState } from '../../hash-router';
import type { Model } from '../../../model/parse';
import type {
  FlowDiagram,
  FlowProcess,
  FlowExternal,
  FlowStoreRef,
} from '../../../flows/flow-parse';
import type { ProcessUsage } from '../../../flows/flow-usage-index';

// ---------------------------------------------------------------------------
// FlowChromeCallbacks — typed contract between initFlowGraphCore and App shell.
// ---------------------------------------------------------------------------

// Chrome callbacks: typed interface so both initFlowGraphCore and the FlowsView
// component share the same contract. The FlowChrome React component drives these
// from its useImperativeHandle handle.
export interface FlowChromeCallbacks {
  /** Called on every breadcrumb change (DFD select, drill-down, drill-up). */
  onStackChange: (stack: BreadcrumbEntry[]) => void;
  /** Called once on init and on each SSE re-render with the full diagram list. */
  onDiagramsChange: (all: FlowDiagram[], activeId: string) => void;
  /**
   * Called by the core once after init, providing the imperative drill handlers.
   * The FlowsView component stores these in refs so FlowChrome callbacks can invoke
   * them without DOM extension (no `as` casts at call sites).
   */
  onRegisterHandlers: (
    drillUp: (idx: number) => void,
    selectDiagram: (id: string) => void,
  ) => void;
  /** Called on pan/zoom/drag to update the minimap in FlowChrome. */
  onViewChange?: (data: MinimapData) => void;
  /** Called once to register the reset-layout callback; null to clear. */
  onResetLayout?: (fn: (() => void) | null) => void;
  /** Called to register a panTo(worldX, worldY) function for the minimap; null to clear. */
  onRegisterPanTo?: (fn: ((worldX: number, worldY: number) => void) | null) => void;
  /**
   * Called once to register a retheme(mode) function. Calling it updates the
   * flow SVG palette without tearing down and rebuilding the renderer — preserves
   * the selected DFD and drill-down stack.
   */
  onRegisterRetheme?: (fn: ((mode: 'dark' | 'light') => void) | null) => void;
  /**
   * Called once to register a function that applies a live search-token set
   * (graph-flow-search CP3) to the current diagram without rebuilding the
   * renderer — preserves the selected DFD and drill-down stack the same way
   * onRegisterRetheme does. Calling it with null clears active search dimming.
   */
  onRegisterSearchTokens?: (fn: ((tokens: ReadonlySet<string> | null) => void) | null) => void;
  /**
   * Called on every diagram render — top-level select, drill-down, and drill-up.
   * The id is the diagram being rendered (the current top of the breadcrumb stack).
   * Used by FlowsView to write the `dfd` URL hash param so the active DFD is
   * deep-linkable at every level.
   */
  onActiveDiagramChange?: (id: string) => void;
  /**
   * Called whenever the SVG scale changes (wheel, zoom control, reset) or the
   * container resizes. `scale` is the inner-<g> factor (1 = fit); `fitScale` is
   * the viewBox→container ratio. The true zoom = scale × fitScale, so the readout
   * shows native-1:1-relative percent (#3 viewer-ux-polish), not a fit baseline.
   */
  onZoomChange?: (scale: number, fitScale: number) => void;
  /**
   * Called once on each diagram render with the imperative zoom operations,
   * and with null when the diagram is torn down. Wired to the flow ZoomControl.
   */
  onRegisterZoomControl?: (ctrl: {
    zoomTo(scale: number): void;
    resetFit(): void;
  } | null) => void;
}

// ---------------------------------------------------------------------------
// FlowSurface — stateful React wrapper around FlowDiagramSvg.
// ---------------------------------------------------------------------------

/**
 * Stateful wrapper around FlowDiagramSvg that owns the doc-dialog state. The ⓘ
 * badge resolves a node's token to a discriminated result:
 * - `entity` → delegates to `onOpenEntity` (rich SelectedEntityModal, app-level).
 * - `node`   → opens the FlowNodeModal (structured facts + markdown).
 * - `doc`    → opens the plain FlowDocModal (markdown only — empty-state fallback).
 * - `null`   → shows a graceful empty-state FlowDocModal ("not found in catalog").
 *
 * In-dialog `[[wiki-links]]` re-resolve through the same path, so entity-targeting
 * links open the rich dialog and flow-node links swap the node or markdown dialog.
 * An absent-entity `db:` token (`null` result) shows an empty-state doc rather
 * than a dead badge, matching the `flow.unknown_store` finding surface.
 */
export function FlowSurface({ svgProps, resolveDoc, onOpenEntity, themeMode, allFlowNodeIds, onRegisterOpen, nodeUsageIndex }: {
  svgProps: Omit<FlowDiagramSvgProps, 'onOpenDoc' | 'themeMode'>;
  resolveDoc: (token: string) => FlowDocResult | null;
  onOpenEntity?: (id: string) => void;
  themeMode: 'dark' | 'light';
  allFlowNodeIds?: ReadonlySet<string>;
  /** Called once on mount with the `open` dispatcher so callers can trigger
   *  in-flow navigation from outside the component (e.g. from the app-level
   *  SelectedEntityModal's process-usage links when opened from the flow view). */
  onRegisterOpen?: (open: (token: string) => void) => void;
  /** Token-keyed usage index (buildFlowNodeUsageIndex) for CP21 Processes section
   *  in external/store dialogs. Optional — omit to suppress the section. */
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>;
}) {
  // Active dialog state. Exactly one may be open at a time.
  const [openResult, setOpenResult] = useState<
    | { kind: 'node'; node: FlowProcess | FlowExternal | FlowStoreRef; allProcesses: FlowProcess[]; doc: FlowDoc }
    | { kind: 'doc'; doc: FlowDoc }
    | null
  >(null);

  // Keep a stable ref to `open` so onRegisterOpen only fires once (no deps churn).
  const openRef = useRef<(token: string) => void>(() => {});

  const open = (token: string) => {
    const result = resolveDoc(token);
    if (result === null) {
      // Absent entity / unknown token — show an empty-state doc so the badge
      // isn't silently dead. `db:` absent entities are surfaced by flow.unknown_store;
      // this fallback prevents a crash and gives the user a clear signal.
      const { name } = splitDocToken(token);
      setOpenResult({ kind: 'doc', doc: { title: name, bodyHtml: '<p class="entity-link entity-link--missing">Not found in the entity catalog.</p>' } });
      return;
    }
    if (result.kind === 'entity') {
      // Close any open dialog before opening the rich entity dialog so
      // only one modal is visible at a time — both badge clicks and wiki-link
      // clicks in the flow dialog come through this path.
      setOpenResult(null);
      onOpenEntity?.(result.entityId);
      return;
    }
    setOpenResult(result);
  };
  openRef.current = open;

  // Register the `open` dispatcher with the app level on mount so it can route
  // in-flow navigation (e.g. process-usage link clicks in a flow-opened entity
  // dialog) without switching the view to the Dictionary or Graph.
  useEffect(() => {
    if (onRegisterOpen) onRegisterOpen((token: string) => openRef.current(token));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => setOpenResult(null);

  return (
    <>
      <FlowDiagramSvg {...svgProps} themeMode={themeMode} onOpenDoc={open} />
      {openResult?.kind === 'node' && (
        <FlowNodeModal
          node={openResult.node}
          allProcesses={openResult.allProcesses}
          doc={openResult.doc}
          onClose={close}
          onNavigate={open}
          allFlowNodeIds={allFlowNodeIds}
          canOpenToken={(tok) => resolveDoc(tok) !== null}
          nodeUsageIndex={nodeUsageIndex}
        />
      )}
      {openResult?.kind === 'doc' && (
        <FlowDocModal doc={openResult.doc} onClose={close} onNavigate={open} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// initFlowGraphCore — imperative renderer lifecycle.
// ---------------------------------------------------------------------------

// Core flow graph setup. Extracted so both static and live modes can call it.
// allDiagrams is passed in rather than read from globals so the live path can
// pass fresh data on each SSE-triggered re-render.
// startDiagramId: which top-level DFD to render first (null → first in array).
// onDiagramChange: called whenever the selected top-level DFD changes.
// chromeCallbacks: optional — when provided, the FlowChrome React component drives
//   the breadcrumb/selector UI; when absent (e.g. static mode without React chrome),
//   the function falls back to no-ops.
export function initFlowGraphCore(
  container: HTMLDivElement,
  allDiagrams: FlowDiagram[],
  startDiagramId: string | null,
  onDiagramChange?: (id: string) => void,
  chromeCallbacks?: FlowChromeCallbacks,
  initialThemeMode: 'dark' | 'light' = 'dark',
  // Accepts a getter (() => Model | undefined) so callers can thread a ref and
  // always resolve the live entity-id set — or a plain Model for static mode.
  entityModel?: (() => Model | undefined) | Model,
  onOpenEntity?: (id: string) => void,
  onRegisterOpen?: (open: (token: string) => void) => void,
  // Theme config getter so kind-colored stores resolve the live theme.flowKinds overrides.
  getThemeConfig?: () => ThemeConfig | undefined,
  // CP21: token-keyed usage index so ext/store dialogs can render Processes section.
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>,
  // graph-flow-search CP3: initial search-token set for in-diagram dimming.
  // Kept live via chromeCallbacks.onRegisterSearchTokens (see currentSearchTokens
  // below) rather than a dependency-array rebuild, so typing a search term never
  // tears down the renderer — that would lose the drill-down stack.
  initialSearchTokens?: ReadonlySet<string> | null,
): () => void {
  // Resolver for node ⓘ docs + in-dialog [[links]]. The entityModel parameter
  // may be a getter (() => Model | undefined) so the resolver always reads the
  // live entity-id set on each call — falling back to window.__MODEL__ if neither
  // the caller nor the getter provides a model (static mode with no explicit arg).
  const resolveDoc = buildFlowDocResolver(
    allDiagrams,
    entityModel ?? window.__MODEL__,
  );

  // Build the full set of flow node IDs (entities + processes + externals + non-db stores)
  // once for this renderer lifecycle. Used by FlowNodeModal's upgrade pass so
  // ext:/proc: references in dialog bodies render as live links, not missing spans.
  const resolvedEntityModel: Model | undefined =
    typeof entityModel === 'function' ? entityModel() : entityModel ?? window.__MODEL__;
  const allFlowNodeIds = buildAllFlowNodeIds(allDiagrams, resolvedEntityModel);

  // Persistence: flow positions use a separate localStorage key so they never
  // touch the ERD's 'ignatius-layout-positions' bucket.
  const flowLayoutStore = createLayoutStore(
    globalThis.localStorage,
    undefined,
    'ignatius-flow-layout-positions',
  );

  // Breadcrumb stack: array of { diagram, label } from the selected top-level DFD down.
  // The current diagram is always the last entry.
  const stack: Array<{ diagram: FlowDiagram; label: string }> = [];

  // Live search-token set (graph-flow-search CP3). Updated in place by
  // chromeCallbacks.onRegisterSearchTokens without rebuilding the renderer —
  // survives drill-down/selectDiagramById since it lives in this closure,
  // outside renderDiagram.
  let currentSearchTokens: ReadonlySet<string> | null = initialSearchTokens ?? null;

  // Current palette mode. Updated by retheme() without rebuilding the renderer.
  let currentThemeMode: 'dark' | 'light' = initialThemeMode;

  // The container must be position:relative for absolute children.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // Track the active selector id for chrome callback
  let activeSelectorId: string = startDiagramId ?? allDiagrams[0]!.id;

  function pushChromeState() {
    chromeCallbacks?.onStackChange(stack.map(s => ({ label: s.label })));
  }

  // --- SVG React root ---
  // The flow renderer mounts FlowDiagramSvg into a dedicated sub-div inside
  // the container. On diagram swap (DFD select or drill-down), the old root
  // is unmounted and a new one is created, mirroring the Cytoscape destroy/init
  // lifecycle it replaces.
  let svgRoot: ReactRoot | null = null;
  let svgContainer: HTMLDivElement | null = null;
  // Monotonically increasing render generation. Each renderDiagram call captures
  // its generation number; after any await the call checks whether it is still the
  // latest — if a newer call started while ELK was computing, the stale call aborts.
  let renderGen = 0;
  // Set true by the teardown function returned below. renderGen alone only
  // guards against a NEWER renderDiagram call within this same still-alive
  // instance; it does nothing when the whole instance is torn down (e.g. React
  // StrictMode's dev-mode mount→cleanup→mount, or the user navigating away
  // while ELK is still computing) — svgRoot is still null at that point (the
  // async call hasn't reached "create root" yet), so teardown has nothing to
  // unmount, and the orphaned continuation later resumes, finds the shared
  // `container` still connected, and injects a second live React root into it.
  // Checked after every await in renderDiagram so a disposed instance never
  // touches the DOM again.
  let disposed = false;

  // Returns the fingerprint for a diagram id from the injected layout keys map.
  // Static: window.__FLOW_LAYOUT_KEYS__; live: injected by the app-level flow
  // effect's applyFlowPayload before the renderer calls initFlowGraphCore.
  function layoutKeyFor(diagramId: string): string {
    return window.__FLOW_LAYOUT_KEYS__?.[diagramId] ?? '';
  }

  async function renderDiagram(diagram: FlowDiagram) {
    // This instance was torn down before this call even started (e.g. queued
    // via resetLayout/drillUp right as the effect cleaned up) — bail before
    // touching anything.
    if (disposed) return;

    // Claim this render generation. Any concurrent renderDiagram that starts
    // while we await ELK will bump renderGen and invalidate ours.
    renderGen += 1;
    const myGen = renderGen;

    // Unmount previous SVG root immediately (prevents the old diagram showing
    // while ELK computes positions for the new one).
    if (svgRoot) {
      svgRoot.unmount();
      svgRoot = null;
    }
    if (svgContainer && svgContainer.parentNode) {
      svgContainer.parentNode.removeChild(svgContainer);
      svgContainer = null;
    }
    window.__IGNATIUS_FLOW_READY__ = false;

    // Load saved positions for this diagram.
    const layoutKey = layoutKeyFor(diagram.id);
    const savedPositions: PositionMap | null = layoutKey
      ? flowLayoutStore.load(layoutKey)
      : null;

    // Always run ELK to get the deterministic base positions, then layer
    // savedPositions drag overrides on top. This prevents the hybrid-layout
    // bug where a partial drag (only some nodes moved) would leave non-dragged
    // nodes at banded fallback positions instead of ELK positions.
    // ELK is deterministic, so re-running it on re-render produces no churn.
    let elkPositions: ElkPositionMap | undefined;
    let elkEdgeRoutes: Record<string, Array<{ x: number; y: number }>> | undefined;
    try {
      const elkResult = await computeElkLayout(diagram);
      // Guard: if a newer renderDiagram call started while ELK was computing
      // (e.g. the user clicked a different DFD), abort — the newer call wins.
      // Guard: if this WHOLE instance was torn down while we awaited (e.g.
      // React StrictMode's dev-mode mount→cleanup→mount, or navigating away
      // and back before ELK finished) — svgRoot was still null when teardown
      // ran, so it had nothing to unmount; without this check the orphaned
      // call would resume, find `container` still connected (App keeps every
      // view's container mounted across view switches), and inject a second
      // live React root into it.
      if (renderGen !== myGen || disposed) return;
      elkPositions = elkResult.positions;
      // CP4b: capture routed edge geometry alongside positions.
      // On ELK failure (catch below), elkEdgeRoutes stays undefined so the
      // renderer falls back to orthogonalPath for all edges — no regression.
      elkEdgeRoutes = elkResult.edgeRoutes;
    } catch (err) {
      // ELK layout failure is non-fatal: fall back to banded positions.
      console.warn('[ignatius] ELK layout failed, falling back to banded positions:', err);
      if (renderGen !== myGen || disposed) return;
    }

    // Guard: if the container element itself was removed from the document
    // (a full unmount, not just this instance's teardown), abort.
    if (!container.isConnected) return;

    // Create a fresh full-bleed sub-div for the SVG.
    const div = document.createElement('div');
    div.setAttribute('data-ignatius', 'flow-svg-host');
    Object.assign(div.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });
    container.appendChild(div);
    svgContainer = div;

    // Drill handler: called by FlowDiagramSvg when user clicks a drillable process.
    function handleDrill(processId: string) {
      const currentDiagram = stack[stack.length - 1]!.diagram;
      const subDfd = currentDiagram.subDfds.find(d => d.id === processId);
      if (!subDfd) {
        console.warn(`[ignatius] drill-down: no sub-DFD found for process '${processId}'`);
        return;
      }
      const proc = currentDiagram.processes.find(p => p.id === processId);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : processId;
      stack.push({ diagram: subDfd, label });
      pushChromeState();
      void renderDiagram(subDfd);
    }

    // Reset layout for this diagram: clear saved positions and re-render with
    // ELK positions (or banded fallback). Registered with FlowChrome so the FAB
    // can trigger it.
    function resetLayout() {
      if (layoutKey) flowLayoutStore.clear(layoutKey);
      void renderDiagram(diagram);
    }
    chromeCallbacks?.onResetLayout?.(resetLayout);

    // Mount the SVG renderer.
    const root = createRoot(div);
    svgRoot = root;

    function doRender(themeMode: 'dark' | 'light') {
      // Guard: if this diagram's root has been replaced (teardown + remount during a
      // diagram switch or SSE re-render), skip the render — the current root owns the DOM.
      if (svgRoot !== root) return;
      // Resolve kind palette from the live theme config (falls back to defaults when
      // the theme has no flowKinds override — same pattern as semanticColors).
      const themeConfig = getThemeConfig?.();
      const kindPalette = resolveFlowKindPalette(themeMode, themeConfig?.flowKinds);
      root.render(
        createElement(FlowSurface, {
          resolveDoc,
          onOpenEntity,
          themeMode,
          allFlowNodeIds,
          onRegisterOpen,
          nodeUsageIndex,
          svgProps: {
            diagram,
            kindPalette,
            searchTokens: currentSearchTokens,
            onDrill: handleDrill,
            onReady: () => {
              window.__IGNATIUS_FLOW_READY__ = true;
              window.__IGNATIUS_FLOW_GEN__ = (window.__IGNATIUS_FLOW_GEN__ ?? 0) + 1;
            },
            elkPositions,
            elkEdgeRoutes,
            savedPositions: savedPositions ?? undefined,
            layoutKey,
            onPositionsChange: (posMap: PositionMap) => {
              if (layoutKey) flowLayoutStore.save(layoutKey, posMap);
            },
            onViewChange: (data: MinimapData) => {
              chromeCallbacks?.onViewChange?.(data);
            },
            onRegisterPanTo: (fn: ((worldX: number, worldY: number) => void) | null) => {
              chromeCallbacks?.onRegisterPanTo?.(fn);
            },
            onZoomChange: (s: number, fitScale: number) => {
              chromeCallbacks?.onZoomChange?.(s, fitScale);
            },
            onRegisterZoomControl: (ctrl) => {
              chromeCallbacks?.onRegisterZoomControl?.(ctrl);
            },
          },
        }),
      );
    }

    doRender(currentThemeMode);

    // Register the retheme hook — re-renders with updated palette without
    // unmounting (React reconciles in-place, preserving interaction state).
    chromeCallbacks?.onRegisterRetheme?.((mode) => {
      currentThemeMode = mode;
      doRender(mode);
    });

    // Register the search-tokens hook — same live-update pattern as retheme:
    // re-renders with the new match set without unmounting, so the drill-down
    // stack and breadcrumb position survive every keystroke.
    chromeCallbacks?.onRegisterSearchTokens?.((tokens) => {
      currentSearchTokens = tokens;
      doRender(currentThemeMode);
    });

    // Notify the app that the active diagram changed so it can update the URL hash.
    chromeCallbacks?.onActiveDiagramChange?.(diagram.id);

    pushChromeState();
  }

  function drillUp(targetIdx: number) {
    // Truncate the stack to targetIdx + 1 (keeping entries 0..targetIdx)
    stack.splice(targetIdx + 1);
    const target = stack[stack.length - 1];
    if (!target) return;
    pushChromeState();
    void renderDiagram(target.diagram);
    // onActiveDiagramChange fired inside renderDiagram above.
  }

  // Recursively search allDiagrams (and their sub-DFD trees) for a diagram with the
  // given id, returning the path of ancestor diagrams from the top-level root down
  // to (and including) the found diagram. Returns null if not found.
  function findDiagramPath(id: string): FlowDiagram[] | null {
    function search(diagrams: FlowDiagram[], path: FlowDiagram[]): FlowDiagram[] | null {
      for (const d of diagrams) {
        if (d.id === id) return [...path, d];
        const found = search(d.subDfds, [...path, d]);
        if (found) return found;
      }
      return null;
    }
    return search(allDiagrams, []);
  }

  // selectDiagramById: resolves the diagram by id whether top-level OR sub-DFD.
  // Rebuilds the breadcrumb stack to reflect the full ancestor path, then renders.
  // Used by both the popstate/back-nav path AND the FlowChrome DFD selector.
  function selectDiagramById(id: string) {
    const path = findDiagramPath(id);
    if (!path || path.length === 0) return;
    const target = path.at(-1);
    if (!target) return;
    // Rebuild stack: each step in the path becomes a breadcrumb entry.
    const newStack = path.map((d, i) => {
      if (i === 0) return { diagram: d, label: d.title };
      // For sub-DFD entries, find the process label in the parent diagram.
      const parent = path[i - 1];
      if (!parent) return { diagram: d, label: d.title };
      const proc = parent.processes.find(p => p.id === d.id);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : d.title;
      return { diagram: d, label };
    });
    stack.splice(0, stack.length, ...newStack);
    // Update the top-level active selector to the root of this path.
    const rootId = path[0]?.id ?? target.id;
    activeSelectorId = rootId;
    onDiagramChange?.(rootId);
    chromeCallbacks?.onDiagramsChange(allDiagrams, rootId);
    pushChromeState();
    void renderDiagram(target);
  }

  // Seed the stack with the starting DFD (preserving selection across SSE re-renders).
  // Use findDiagramPath so a deep-linked sub-DFD id resolves correctly and the
  // full ancestor breadcrumb chain is established from the first render.
  const startPath = startDiagramId !== null ? findDiagramPath(startDiagramId) : null;
  if (startPath && startPath.length > 0) {
    // Build the initial stack for every ancestor step in the path.
    const newStack = startPath.map((d, i) => {
      if (i === 0) return { diagram: d, label: d.title };
      const parent = startPath[i - 1];
      if (!parent) return { diagram: d, label: d.title };
      const proc = parent.processes.find(p => p.id === d.id);
      const label = proc ? `${proc.dottedNumber} ${proc.label}` : d.title;
      return { diagram: d, label };
    });
    stack.push(...newStack);
    // activeSelectorId should reflect the root of this path.
    // startPath.length > 0 is guaranteed by the enclosing guard, so both
    // index accesses are safe; extract locals so TypeScript can narrow them.
    const pathRoot = startPath[0];
    const startDiagram = startPath[startPath.length - 1];
    if (!pathRoot || !startDiagram) return () => {}; // unreachable — length > 0
    activeSelectorId = pathRoot.id;
    onDiagramChange?.(startDiagram.id);
    chromeCallbacks?.onDiagramsChange(allDiagrams, activeSelectorId);
    chromeCallbacks?.onRegisterHandlers(drillUp, selectDiagramById);
    void renderDiagram(startDiagram);
  } else {
    // startDiagramId was null, unknown, or stale — fall back to first top-level diagram.
    const startDiagram = allDiagrams[0]!;
    stack.push({ diagram: startDiagram, label: startDiagram.title });
    onDiagramChange?.(startDiagram.id);
    chromeCallbacks?.onDiagramsChange(allDiagrams, activeSelectorId);
    chromeCallbacks?.onRegisterHandlers(drillUp, selectDiagramById);
    void renderDiagram(startDiagram);
  }

  return () => {
    // Set before anything else: any renderDiagram call still awaiting ELK at
    // this point must resume as a no-op instead of racing the next instance
    // for the shared `container` (see the disposed checks above).
    disposed = true;
    chromeCallbacks?.onResetLayout?.(null);
    chromeCallbacks?.onRegisterRetheme?.(null);
    chromeCallbacks?.onRegisterSearchTokens?.(null);
    if (svgRoot) {
      svgRoot.unmount();
      svgRoot = null;
    }
    if (svgContainer && svgContainer.parentNode) {
      svgContainer.parentNode.removeChild(svgContainer);
      svgContainer = null;
    }
    window.__IGNATIUS_FLOW_READY__ = false;
    window.__IGNATIUS_ACTIVE_FLOW_DFD__ = undefined;
  };
}

// ---------------------------------------------------------------------------
// FlowsViewHandle — shell↔view typed contract.
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed by FlowsView to the shell (App). The shell calls
 * into the view for actions that originate outside the flow surface:
 * - `selectDiagramById`: back/forward popstate navigation to a DFD id.
 * - `resetLayout`:       FAB "Reset layout" action.
 * - `zoomIn` / `zoomOut` / `setPercent` / `resetZoom`: ZoomControl wiring.
 * - `zoomPercent`:       current ZoomControl readout (read-only; use the
 *                        `onZoomPercentChange` prop for live updates).
 * - `openFlowToken`:     route a flow-node token (proc:/ext:/db:) to the in-flow
 *                        dialog dispatcher — used by flow-context entity modals.
 */
export interface FlowsViewHandle {
  selectDiagramById(id: string): void;
  resetLayout(): void;
  zoomIn(): void;
  zoomOut(): void;
  setPercent(pct: number): void;
  resetZoom(): void;
  openFlowToken(token: string): void;
}

// ---------------------------------------------------------------------------
// FlowsViewProps
// ---------------------------------------------------------------------------

export interface FlowsViewProps {
  /** The shared container div that the flow renderer mounts into. App owns this element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether this view is currently active. The renderer effect guards on this. */
  isActive: boolean;
  /** The current flow diagrams list (null = not yet fetched). */
  flowDiagrams: FlowDiagram[] | null;
  /** Current theme mode — drives SVG palette and chrome. */
  themeMode: 'dark' | 'light';
  /** Getter for the live entity model (used by doc resolver). */
  getEntityModel: () => Model | undefined;
  /** Getter for the live theme config (used by kind-palette resolver). */
  getThemeConfig: () => ThemeConfig | undefined;
  /** Called when the user opens a `db:` store node — opens the rich entity modal. */
  onOpenEntity: (id: string, fromFlow: boolean) => void;
  /**
   * Called each time the active DFD changes (initial render + user navigation).
   * The view writes URL hash state; the shell may hook this to track the active
   * id across view switches. Optional — the hash write happens unconditionally
   * inside the view regardless of whether the shell provides this callback.
   */
  onActiveDiagramChange?: (id: string, isInitial: boolean) => void;
  /** Called whenever the flow ZoomControl readout changes. */
  onZoomPercentChange: (pct: number) => void;
  /**
   * Match-set for graph-flow-search CP3: base tokens that keep full opacity in
   * the rendered diagram, threaded through to FlowDiagramSvg's searchTokens
   * prop. null = no active search (no dimming from this source).
   */
  searchTokens: ReadonlySet<string> | null;
}

// ---------------------------------------------------------------------------
// FlowsView component
// ---------------------------------------------------------------------------

export const FlowsView = forwardRef<FlowsViewHandle, FlowsViewProps>(
  function FlowsView(
    {
      containerRef,
      isActive,
      flowDiagrams,
      themeMode,
      getEntityModel,
      getThemeConfig,
      onOpenEntity,
      onActiveDiagramChange = undefined,
      onZoomPercentChange,
      searchTokens,
    },
    ref,
  ) {
    const flowChromeRef = useRef<FlowChromeHandle>(null);
    // Drill handlers registered by initFlowGraphCore via chromeCallbacks.onRegisterHandlers.
    const flowDrillUpRef = useRef<((idx: number) => void) | null>(null);
    const flowSelectDiagramRef = useRef<((id: string) => void) | null>(null);
    // Retheme callback: updates the flow SVG palette without tearing down the renderer.
    const flowRethemeRef = useRef<((mode: 'dark' | 'light') => void) | null>(null);
    // Search-tokens callback: applies live dimming without tearing down the renderer.
    const flowSearchTokensRef = useRef<((tokens: ReadonlySet<string> | null) => void) | null>(null);
    // Flow reset layout: registered by initFlowGraphCore so the FAB can trigger it.
    const flowResetLayoutRef = useRef<(() => void) | null>(null);
    // Tracks the currently selected top-level DFD id across SSE re-renders.
    // Seeded from #dfd= on initial load so deep-linked DFDs render directly.
    const activeFlowDiagramIdRef = useRef<string | null>(
      (() => {
        const h = parseHash(location.hash);
        return (h.view === 'flow' && h.dfd) ? h.dfd : null;
      })(),
    );
    // Zoom control state for the Flows view.
    const [flowZoomPercent, setFlowZoomPercent] = useState(100);
    // Adapter refs wired by onRegisterZoomControl from FlowDiagramSvg.
    const flowZoomToRef = useRef<((scale: number) => void) | null>(null);
    const flowResetFitRef = useRef<(() => void) | null>(null);
    // Live-scale mirror so zoom operations always read the current scale, not a stale closure value.
    const flowScaleRef = useRef(1);
    // Live fitScale mirror (viewBox→container ratio). Drives percent↔scale
    // conversion so the readout shows true zoom and setPercent(100) → 1:1.
    const flowFitScaleRef = useRef(1);
    // In-flow open dispatcher — registered by FlowSurface on mount. The shell uses
    // this to route process-usage link clicks in a flow-opened entity modal in-place.
    const flowOpenRef = useRef<((token: string) => void) | null>(null);

    // Expose the handle to the shell.
    useImperativeHandle(ref, () => ({
      selectDiagramById(id: string) {
        flowSelectDiagramRef.current?.(id);
      },
      resetLayout() {
        flowResetLayoutRef.current?.();
      },
      zoomIn() {
        // Relative step on the internal scale; the SVG clamps to MIN/MAX_SCALE.
        // True percent steps proportionally since true = scale × fitScale.
        const ctrl = flowZoomToRef.current;
        if (ctrl) ctrl(flowScaleRef.current * 1.1);
      },
      zoomOut() {
        const ctrl = flowZoomToRef.current;
        if (ctrl) ctrl(flowScaleRef.current / 1.1);
      },
      setPercent(pct: number) {
        // pct is the TRUE on-screen zoom; convert to the internal scale that
        // yields it (setPercent(100) → 1/fitScale → native 1:1). The SVG clamps.
        const ctrl = flowZoomToRef.current;
        if (ctrl) ctrl(percentToScreenScale(pct, flowFitScaleRef.current));
      },
      resetZoom() {
        flowResetFitRef.current?.();
      },
      openFlowToken(token: string) {
        flowOpenRef.current?.(token);
      },
    }), []);

    // Flow renderer effect — isActive-keyed. Builds the flow SVG renderer when
    // entering the flow view; tears it down (unmounting React roots + clearing
    // __IGNATIUS_FLOW_READY__) when leaving. Data lives in the app-level flow
    // effect — no EventSource here.
    useEffect(() => {
      if (!isActive) return;
      const container = containerRef.current;
      if (!container) return;

      // Tracks whether the first onActiveDiagramChange call has fired in this effect
      // run. The first call is always an auto-select (initial render) and must use
      // replaceState; all subsequent calls are user-driven and use pushState.
      let initialActivationDone = false;

      // Wire chrome callbacks so the FlowChrome component's state stays in sync
      // with the imperative SVG render core.
      const chromeCallbacks: FlowChromeCallbacks = {
        onStackChange: (stack) => {
          flowChromeRef.current?.setStack(stack);
        },
        onDiagramsChange: (all, activeId) => {
          flowChromeRef.current?.setDiagrams(all, activeId);
        },
        onRegisterHandlers: (drillUp, selectDiagram) => {
          flowDrillUpRef.current = drillUp;
          flowSelectDiagramRef.current = selectDiagram;
        },
        onViewChange: (data) => {
          flowChromeRef.current?.setMinimap(data);
        },
        onResetLayout: (fn) => {
          flowResetLayoutRef.current = fn;
        },
        onRegisterPanTo: (fn) => {
          flowChromeRef.current?.setMinimapPanTo(fn);
        },
        onRegisterRetheme: (fn) => {
          flowRethemeRef.current = fn;
        },
        onRegisterSearchTokens: (fn) => {
          flowSearchTokensRef.current = fn;
        },
        onActiveDiagramChange: (id) => {
          activeFlowDiagramIdRef.current = id;
          window.__IGNATIUS_ACTIVE_FLOW_DFD__ = id;
          // Write the active DFD id into the URL hash so the view is deep-linkable.
          const current = parseHash(location.hash);
          const next: HashState = { ...current, view: 'flow', dfd: id };
          const serialized = serializeHash(next);
          const newHash = serialized ? '#' + serialized : location.pathname;
          // Use replaceState on the very first activation in this effect run — the
          // initial auto-select of diagrams[0] or the preserved prevId. This avoids
          // polluting history: Back after switching to the flow view should return to
          // the pre-flow state, not loop through #view=flow (no dfd).
          const isInitial = !initialActivationDone || location.hash === newHash;
          if (isInitial) {
            history.replaceState({}, '', newHash);
          } else {
            history.pushState({}, '', newHash);
          }
          initialActivationDone = true;
          onActiveDiagramChange?.(id, isInitial);
        },
        onZoomChange: (s, fitScale) => {
          flowScaleRef.current = s;
          flowFitScaleRef.current = fitScale;
          // True on-screen zoom: 100% = native 1:1. At fit (s===1) this is
          // fitScale×100 (e.g. ~42% on a large model), not a forced 100.
          const pct = screenScaleToPercent(s, fitScale);
          setFlowZoomPercent(pct);
          onZoomPercentChange(pct);
        },
        onRegisterZoomControl: (ctrl) => {
          flowZoomToRef.current = ctrl ? ctrl.zoomTo : null;
          flowResetFitRef.current = ctrl ? ctrl.resetFit : null;
          // The diagram mounts at fit (scale 1). The real readout is reported by
          // onZoomChange once the SVG measures its container; no forced 100 here.
        },
      };

      // In live mode use hoisted flowDiagrams (set by the app-level flow effect).
      // In static mode fall back to window.__FLOW_MODEL__ (no SSE, globals set at page-gen time).
      const diagrams = window.__IGNATIUS_MODE__ === 'live'
        ? (flowDiagrams ?? [])
        : (window.__FLOW_MODEL__ ?? []);

      if (diagrams.length === 0) {
        // Data not yet arrived (live) or not injected (static). Nothing to render.
        return;
      }

      // Preserve the user's selected DFD across SSE re-renders.
      const prevId = activeFlowDiagramIdRef.current;
      const startId = prevId ?? diagrams[0]!.id;

      // Pass a getter (not a snapshot) for the entity model so the resolver always
      // reads the LIVE entity-id set even when model changes via SSE without
      // triggering a flow-effect re-run.
      const stableOpenEntity = (id: string) => onOpenEntity(id, true);

      // CP21: build the token-keyed usage index for ext/store Processes sections.
      const nodeUsageIndex = buildFlowNodeUsageIndex(diagrams);

      const cleanup = initFlowGraphCore(
        container,
        diagrams,
        startId,
        (id) => {
          activeFlowDiagramIdRef.current = id;
          window.__IGNATIUS_ACTIVE_FLOW_DFD__ = id;
        },
        chromeCallbacks,
        themeMode,
        getEntityModel,
        stableOpenEntity,
        (open) => { flowOpenRef.current = open; },
        getThemeConfig,
        nodeUsageIndex,
        searchTokens,
      );
      return cleanup;
    }, [isActive, flowDiagrams]); // eslint-disable-line react-hooks/exhaustive-deps
    // Note: themeMode intentionally excluded — retheme is handled by the separate effect below.
    // onOpenEntity, getEntityModel, getThemeConfig are stable refs/callbacks — not deps.
    // searchTokens intentionally excluded — live updates handled by the separate
    // effect below (mirrors themeMode/retheme); this call only seeds the initial value.

    // Re-theme the flow SVG whenever the theme changes while the flow view is active.
    // Uses the registered retheme callback which calls root.render() with the new
    // themeMode — React reconciles in-place without unmounting, preserving state.
    useEffect(() => {
      if (isActive) flowRethemeRef.current?.(themeMode);
    }, [themeMode, isActive]);

    // Apply the live search-token set (graph-flow-search CP3) whenever it
    // changes while the flow view is active. Uses the registered callback
    // which calls root.render() in place — no renderer rebuild, so the
    // drill-down stack survives every keystroke.
    useEffect(() => {
      if (isActive) flowSearchTokensRef.current?.(searchTokens);
    }, [searchTokens, isActive]);

    // FlowsView renders only the FlowChrome overlay and leaves the actual diagram
    // DOM managed by the imperative initFlowGraphCore inside the containerRef.
    // FlowChrome is gated on isActive to match the original `isFlowSurface &&` guard.
    if (!isActive) return null;

    return (
      <FlowChrome
        ref={flowChromeRef}
        onSelectDiagram={(id) => flowSelectDiagramRef.current?.(id)}
        onDrillUp={(idx) => flowDrillUpRef.current?.(idx)}
        themeMode={themeMode}
      />
    );
  },
);
