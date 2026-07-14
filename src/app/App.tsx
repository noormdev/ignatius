import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { semanticColors, resolveFlowKindPalette, type FlowKindKey, type FlowKindEntry } from '../theme/theme-defaults';
import { parseHash } from './hash-router';
import { RULES } from '../model/validate';
import type { EntityError } from '../model/validate';
import type {
  Model,
  ModelNode,
  GroupConfig,
} from '../model/parse';
import { buildEntityUsageIndex } from '../flows/flow-usage-index';
import { buildModelIndex } from '../model/model-index';
import type { ModelIndex } from '../model/model-index';
import { hexToRgba } from './logic/color';
import { buildAllFlowNodeIds } from './logic/flow-node-ids';
import { entityMatches, searchFlowDiagrams } from './logic/search';
import { Modal } from './components/ui/Modal';
import { HelpModal } from './components/ui/HelpModal';
import { ZoomControl } from './components/ui/ZoomControl';
import { SearchBar } from './components/ui/SearchBar';
import type { SearchBarHandle } from './components/ui/SearchBar';
import { FlowSearchResults } from './components/flow/FlowSearchResults';
import { EntityModal } from './components/entity/EntityModal';
import { FindingsPanel } from './components/findings/FindingsPanel';
import { LegendModal } from './views/flow/LegendModal';
import { FlowsView } from './views/flow/FlowsView';
import type { FlowsViewHandle } from './views/flow/FlowsView';
import { DictionaryView } from './views/dict/DictionaryView';
import type { DictionaryViewHandle } from './views/dict/DictionaryView';
import { GraphView } from './views/graph/GraphView';
import type { GraphViewHandle, LayoutMode } from './views/graph/GraphView';
import { FabMenu } from './components/ui/FabMenu';
import { useModelData } from './hooks/useModelData';
import { useHashRoute } from './hooks/useHashRoute';
import { useThemeMode } from './hooks/useThemeMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export function App() {
  const graphRef = useRef<HTMLDivElement>(null);
  // Handle to GraphView — provides navigateToEntity, panelNavigate, resetLayout,
  // applyLayoutMode, zoom ops, retheme.
  const graphViewRef = useRef<GraphViewHandle>(null);
  // Minimap container: rendered in shell JSX, ref passed down to GraphView.
  const minimapRef = useRef<HTMLDivElement>(null);
  // Global-error banner: ref used ONLY to measure its rendered height (see the
  // layout effect below) so the search bar can offset below it — the banner's
  // height is dynamic (row count varies with error count / text wrap width).
  const bannerRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<ModelNode | null>(null);

  const {
    model,
    findings,
    flowDiagrams,
    flowFindings,
    layoutKeyRef,
    bannerDismissed,
    setBannerDismissed,
  } = useModelData({
    onSseRefresh: (cleanedModel) => {
      setSelected(prev => {
        if (!prev) return null;
        const updated = cleanedModel.nodes.find(n => n.id === prev.id);
        return updated ?? null;
      });
    },
  });

  // Handle to FlowsView — provides selectDiagramById, resetLayout, zoom ops, openFlowToken.
  const flowsViewRef = useRef<FlowsViewHandle>(null);
  // Handle to DictionaryView — provides toggleLens for keyboard shortcut.
  const dictViewRef = useRef<DictionaryViewHandle>(null);
  // Handles to the per-view SearchBar — the `/` shortcut (CP4) focuses whichever
  // one belongs to the active view; Dictionary is reached via dictViewRef instead
  // since its search input lives inside DictionaryView, not a SearchBar.
  const graphSearchBarRef = useRef<SearchBarHandle>(null);
  const flowSearchBarRef = useRef<SearchBarHandle>(null);

  const { view, setView, openEntity, closeEntity } = useHashRoute({
    onRestoreDfd: (dfdId) => flowsViewRef.current?.selectDiagramById(dfdId),
    // popstate reconcile: open/switch/close the modal to MATCH the hash. Sets
    // React state ONLY — never pushes history (we are responding to Back/Forward).
    onEntityChange: (id) => {
      if (id === null) {
        setShowEntityModal(false);
        setEntityModalOpenedFromFlow(false);
        return;
      }
      const node = modelIndexRef.current?.nodeById.get(id);
      if (node) {
        setSelected(node);
        setShowEntityModal(true);
      }
    },
  });

  const { themeMode, toggleTheme } = useThemeMode(model?.theme, model);

  // Zoom readout for the Flows view ZoomControl — updated by FlowsView via onZoomPercentChange.
  const [flowZoomPercent, setFlowZoomPercent] = useState(100);
  // Lifted from GraphView via onCyInitError — shell renders the error fallback.
  const [cyInitError, setCyInitError] = useState<string | null>(null);
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    return localStorage.getItem('ignatius-minimap') === 'true';
  });
  // Lifted from GraphView via onCyReadyChange — shell gates ZoomControl/minimap rendering.
  const [cyReady, setCyReady] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Dictionary state — keep-mounted so search text + scroll survive view switches.
  const [dictSearchText, setDictSearchText] = useState('');
  const [dictNavOpen, setDictNavOpen] = useState(false);
  // Graph search state (graph-flow-search CP2) — term + includeBody, survive
  // view switches the same way dictSearchText does (shell-owned useState, not
  // reset on unmount since GraphView stays mounted across view switches).
  const [graphSearchTerm, setGraphSearchTerm] = useState('');
  const [graphSearchIncludeBody, setGraphSearchIncludeBody] = useState(false);
  // Ascending-id cursor for Enter-to-cycle (SC3) — reset whenever the term or
  // body toggle changes so the next Enter always starts from the first match.
  const graphSearchCursorRef = useRef(-1);
  // Flow search state (graph-flow-search CP3) — term + includeBody, survives
  // view switches the same way graphSearchTerm does (shell-owned, FlowsView
  // stays mounted-but-inactive across view switches).
  const [flowSearchTerm, setFlowSearchTerm] = useState('');
  const [flowSearchIncludeBody, setFlowSearchIncludeBody] = useState(false);
  // Pending scroll target: set by onNavigateToProcess, consumed by the view-switch
  // useEffect once the dict container is visible and the process anchor exists.
  const pendingScrollProcessIdRef = useRef<string | null>(null);
  // Pan-free entity opener: selects the node and shows the rich SelectedEntityModal
  // WITHOUT panning the graph. Used by the flow viewer's db: store ⓘ badge so the
  // rich dialog opens even when the ERD graph is not mounted (flow surface).
  //
  // `fromFlow` marks the context: when true, the modal's FK/body/process-usage links
  // navigate in-place via the FlowsView handle instead of switching views.
  //
  // entity= in the URL hash is the single source of truth for "which modal is
  // open". Opening from ANY surface (graph tap, dict click, FK/[[wiki]] hop, flow
  // db: store) pushes ONE history entry via openEntity (it dedups when the hash
  // already carries this same entity). The popstate reconcile (onEntityChange)
  // mirrors React state back when the user navigates Back/Forward.
  function openEntityById(id: string, fromFlow = false) {
    const node = modelIndexRef.current?.nodeById.get(id);
    if (node) {
      setEntityModalOpenedFromFlow(fromFlow);
      setSelected(node);
      setShowEntityModal(true);
      openEntity(id);
    }
  }
  // Ref so the flow effect closure always calls the LIVE opener + reads the LIVE
  // model — without adding `model` to [view, flowDiagrams] deps (which would
  // rebuild/teardown the flow renderer on every entity-only SSE edit).
  const openEntityByIdRef = useRef<(id: string, fromFlow?: boolean) => void>(openEntityById);
  openEntityByIdRef.current = openEntityById;

  // Tracks whether the currently-open SelectedEntityModal was launched from the
  // Flows view (true) or from the Graph/DD view (false). Controls which nav handlers
  // are passed to the modal: flow-context → in-place via FlowsView handle; graph-context → graph pan / setView(dict).
  const [entityModalOpenedFromFlow, setEntityModalOpenedFromFlow] = useState(false);

  // Ref to the live entity model — passed as a getter to buildFlowDocResolver so
  // the resolver's entity-id classification always sees the current model.
  const entityModelRef = useRef<Model | undefined>(undefined);
  entityModelRef.current = model ?? undefined;
  // Ref mirror of modelIndex so cy-init closures and openEntityById always read the
  // live index without stale-closure bugs.
  const modelIndexRef = useRef<ModelIndex | null>(null);
  // NOTE: modelIndexRef.current is updated below, after the modelIndex useMemo.
  // Zoom control state for the Graph view.
  // zoomPercent: live readout (100 = fit-to-view baseline). Updated by GraphView via onZoomPercentChange.
  const [zoomPercent, setZoomPercent] = useState(100);
  // Layout algorithm mode — shell owns it for FAB display; GraphView reads it via prop.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    const stored = localStorage.getItem('ignatius-layout-mode');
    return stored === 'hierarchical' ? 'hierarchical' : 'organic';
  });

  // After a view switch to dict, execute any pending process-scroll that was set
  // by onNavigateToProcess. rAF is not enough — React may not have painted the dict
  // container yet when rAF fires. Running inside a committed useEffect guarantees
  // the DOM is up to date before we attempt scrollIntoView.
  useEffect(() => {
    if (view !== 'dict') return;
    const processId = pendingScrollProcessIdRef.current;
    if (!processId) return;
    pendingScrollProcessIdRef.current = null;
    // Use a short rAF inside the effect so the dict container has fully un-hidden
    // before we query the element (keep-mounted dict uses display:none visibility).
    requestAnimationFrame(() => {
      const el = document.getElementById(`process-${processId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [view]);

  // Re-apply Cytoscape styles when theme mode changes — delegate to GraphView handle
  // which owns cy, svg, and marker refs. Guard on view so it only fires for graph.
  useEffect(() => {
    if (view !== 'graph' || !model) return;
    graphViewRef.current?.retheme(themeMode, model, findings.entityErrors);
  }, [themeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Document title reflects the model display name in both live and static modes.
  // Live: re-runs on every model-change SSE refetch. Static: runs once the
  // injected model is read. Falls back to the constant when the model is
  // unloaded or unnamed.
  useEffect(() => {
    document.title = model?._meta?.name ?? 'Ignatius';
  }, [model]);

  // Whether the flow surface is active — hoisted early since it (and
  // bannerVisible below) are read by both the banner-offset effect and the
  // render's banner gate; a single derivation keeps them from diverging (F-1).
  const isFlowSurface = view === 'flow';
  // Global-error banner visibility: hidden on the flow surface (F-1 — this
  // used to be re-derived independently by the layout effect below and by
  // the render gate; one shared value now feeds both).
  const bannerVisible = !bannerDismissed && findings.globalErrors.length > 0 && !isFlowSurface;

  // Offset the graph search bar below the global-error banner (fixes the bar
  // being fully occluded by the full-width, higher-z-index banner). Measures
  // the banner's REAL rendered height via ResizeObserver rather than a fixed
  // constant because it can wrap into multiple rows (many/long global errors,
  // narrow viewport) — the fixed offset must track that and the bar must
  // snap back to its default top when the banner is dismissed or has no
  // errors. Written as a CSS custom property (consumed by .viewer-search-bar
  // in styles.css) rather than passed as a prop, since SearchBar renders
  // `.viewer-search-bar` directly with no style override slot.
  useLayoutEffect(() => {
    const el = bannerRef.current;
    const root = document.documentElement;
    if (!bannerVisible || !el) {
      root.style.removeProperty('--search-bar-top');
      return;
    }
    const BANNER_GAP = 12; // matches --search-bar-top's no-banner fallback in styles.css
    function applyOffset() {
      root.style.setProperty('--search-bar-top', `${el!.offsetHeight + BANNER_GAP}px`);
    }
    applyOffset();
    const ro = new ResizeObserver(applyOffset);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--search-bar-top');
    };
  }, [bannerVisible]);

  function toggleMinimapOpen() {
    const next = !minimapOpen;
    localStorage.setItem('ignatius-minimap', String(next));
    setMinimapOpen(next);
  }

  // Shared layout-mode toggle — used by BOTH the FAB button and the keyboard shortcut (l).
  // Extracted so both paths invoke exactly the same logic with no duplication.
  function handleToggleLayoutMode() {
    const next = layoutMode === 'organic' ? 'hierarchical' : 'organic';
    setLayoutMode(next);
    localStorage.setItem('ignatius-layout-mode', next);
    graphViewRef.current?.applyLayoutMode(next);
  }

  // Keyboard-zoom (Cmd/Ctrl +/-/0) routes to the ACTIVE view's canvas zoom
  // handle. Graph → GraphView; Flow → FlowsView; Dict has no canvas → no-op.
  // Shares the same handle methods the ZoomControl buttons use (CP3 semantics).
  function handleKeyboardZoomIn() {
    if (view === 'graph') graphViewRef.current?.zoomIn();
    else if (view === 'flow') flowsViewRef.current?.zoomIn();
  }
  function handleKeyboardZoomOut() {
    if (view === 'graph') graphViewRef.current?.zoomOut();
    else if (view === 'flow') flowsViewRef.current?.zoomOut();
  }
  function handleKeyboardZoomReset() {
    if (view === 'graph') graphViewRef.current?.resetZoom();
    else if (view === 'flow') flowsViewRef.current?.resetZoom();
  }

  // Keyboard `/` (SC8) — focus the active view's search input. Graph and Flow
  // route through their SearchBar's focus handle; Dictionary's search input
  // lives inside DictionaryView, reached via its own handle.
  function handleKeyboardSearchFocus() {
    if (view === 'graph') graphSearchBarRef.current?.focus();
    else if (view === 'flow') flowSearchBarRef.current?.focus();
    else if (view === 'dict') dictViewRef.current?.focusSearch();
  }

  // Global keyboard shortcut handler — single window keydown listener.
  // Reads current `view`/callbacks via a ref inside the hook (no stale closures).
  useKeyboardShortcuts({
    view,
    onView: setView,
    onToggleLayout: handleToggleLayoutMode,
    onToggleLens: () => dictViewRef.current?.toggleLens(),
    onZoomIn: handleKeyboardZoomIn,
    onZoomOut: handleKeyboardZoomOut,
    onZoomReset: handleKeyboardZoomReset,
    onHelp: () => setShowHelp(true),
    onSearch: handleKeyboardSearchFocus,
  });

  // NOTE: cy-init effect, navigator toggle effect, and all cy-specific refs have been
  // moved into src/app/views/graph/GraphView.tsx (P2a-2). The shell interacts with the
  // graph renderer exclusively through graphViewRef (GraphViewHandle).


  const groupEntries = model ? Object.entries(model.groups) : [];

  const branding = model?.branding;
  const logoSrc = branding
    ? (themeMode === 'dark' ? branding.logo.dark : branding.logo.light)
    : undefined;

  // Error fallback — cytoscape init threw; render banner instead of blank canvas
  if (cyInitError) {
    return (
      <div className="graph-error-fallback">
        <div className="graph-error-fallback-box">
          <h2>Graph failed to render</h2>
          <p>The graph initializer encountered an error. The model may contain data that Cytoscape cannot process. Check the global errors below and correct the model.</p>
          <pre>{cyInitError}</pre>
        </div>
      </div>
    );
  }

  // Memoize the entity ↔ process usage index so it is only rebuilt when the flow
  // diagrams list changes — not on every render (finding 5).
  const entityUsageIndex = useMemo(
    () => (flowDiagrams ? buildEntityUsageIndex(flowDiagrams) : null),
    [flowDiagrams],
  );

  // Full set of flow + entity node IDs for the flow-opened SelectedEntityModal's
  // upgrade pass. Memoized so it only rebuilds when diagrams or model changes.
  const appAllFlowNodeIds = useMemo(
    () => (flowDiagrams ? buildAllFlowNodeIds(flowDiagrams, model ?? undefined) : null),
    [flowDiagrams, model],
  );

  // O(1) lookup maps over the current parsed model. Rebuilt whenever the model
  // object changes (SSE refetch / static-mode initial load). Never serialized.
  const modelIndex = useMemo(
    () => (model ? buildModelIndex(model) : null),
    [model],
  );

  // Graph search (graph-flow-search CP2, SC1/SC2/SC5): match-set computation
  // over model.nodes using CP1's pure entityMatches. graphSearchActive tracks
  // whether a term is present at all — GraphView's searchMatches prop is null
  // (no active search, nothing dims) when inactive, and a Set (possibly empty,
  // meaning "active search, zero matches — dim everything") when active. Pure
  // UI state: never touches the model, layout fingerprint, layout-store, or
  // URL hash (SC9).
  const graphSearchActive = graphSearchTerm.trim() !== '';
  const graphSearchMatchIds = useMemo(() => {
    if (!model || !graphSearchActive) return [];
    const term = graphSearchTerm.trim();
    const ids: string[] = [];
    for (const node of model.nodes) {
      if (entityMatches(node, term, graphSearchIncludeBody)) ids.push(node.id);
    }
    ids.sort((a, b) => a.localeCompare(b));
    return ids;
  }, [model, graphSearchActive, graphSearchTerm, graphSearchIncludeBody]);
  const graphSearchMatches = useMemo(
    () => (graphSearchActive ? new Set(graphSearchMatchIds) : null),
    [graphSearchActive, graphSearchMatchIds],
  );

  // Reset the Enter-cycle cursor whenever the term or body toggle changes so
  // the next Enter press always starts from the first match in id order.
  useEffect(() => {
    graphSearchCursorRef.current = -1;
  }, [graphSearchTerm, graphSearchIncludeBody]);

  // Enter cycles ascending-id matches, wrapping (SC3). Centers + selects via
  // the existing navigateToEntity handle — no new GraphView method needed.
  function handleGraphSearchEnter() {
    const ids = graphSearchMatchIds;
    if (ids.length === 0) return;
    const next = (graphSearchCursorRef.current + 1) % ids.length;
    const nextId = ids[next];
    if (nextId === undefined) return;
    graphSearchCursorRef.current = next;
    graphViewRef.current?.navigateToEntity(nextId);
  }

  // Flow search (graph-flow-search CP3, SC6/SC7): cross-diagram match list via
  // CP1's searchFlowDiagrams, recomputed whenever the term/toggle/diagram set
  // changes. flowSearchActive gates both the dropdown (SearchBar's results
  // slot) and the token set threaded into FlowsView → FlowDiagramSvg for
  // in-diagram dimming — same "null = inactive, Set = active" contract as
  // the graph search above (SC9: never touches the model, layout store, or hash).
  const flowSearchActive = flowSearchTerm.trim() !== '';
  const flowSearchResults = useMemo(() => {
    if (!flowDiagrams || !flowSearchActive) return [];
    return searchFlowDiagrams(flowDiagrams, flowSearchTerm.trim(), flowSearchIncludeBody);
  }, [flowDiagrams, flowSearchActive, flowSearchTerm, flowSearchIncludeBody]);
  const flowSearchTokens = useMemo(
    () => (flowSearchActive ? new Set(flowSearchResults.map(r => r.token)) : null),
    [flowSearchActive, flowSearchResults],
  );

  // Row click / Enter routes through the existing selectDiagramById, which
  // already reconstructs the full breadcrumb path into any sub-DFD — no new
  // navigation machinery needed. Enter opens the first result (the keyboard
  // path to the top match).
  function handleFlowSearchSelect(diagramId: string) {
    flowsViewRef.current?.selectDiagramById(diagramId);
  }
  function handleFlowSearchEnter() {
    const first = flowSearchResults[0];
    if (first) flowsViewRef.current?.selectDiagramById(first.diagramId);
  }

  // Deep-link modal restore: a URL loaded with entity=<id> opens that modal once
  // the model (and its index) is available. One-shot — guarded by a ref so an
  // SSE model refetch does not re-open a modal the user already closed. Works
  // for any initial view (the shell owns modal state, not GraphView).
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (!modelIndex) return;
    deepLinkHandledRef.current = true;
    const initialEntity = parseHash(location.hash).entity;
    if (initialEntity === undefined) return;
    const node = modelIndex.nodeById.get(initialEntity);
    if (node) {
      // Do NOT call openEntityById here — the hash already carries entity=, so
      // openEntity would dedup anyway, but going straight to state-set keeps the
      // history entry the user landed on intact (no replace/push churn).
      setSelected(node);
      setShowEntityModal(true);
    }
  }, [modelIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // In static mode, liveOnly errors (e.g. example_unknown_column) must be hidden
  // because those validations only run when the server has filesystem access.
  // In live mode all entity errors are shown as-is.
  // Hoisted once here so both SelectedEntityModal and FindingsPanel share the
  // same filtered array without each doing an independent .filter() call.
  const visibleEntityErrors = useMemo(
    () =>
      window.__IGNATIUS_MODE__ === 'static'
        ? findings.entityErrors.filter(e => !RULES[e.ruleId]?.liveOnly)
        : findings.entityErrors,
    [findings.entityErrors],
  );

  // O(1) per-entity error lookup. Built over visibleEntityErrors so the modal
  // receives only the errors it should display, scoped to the selected entity.
  const appErrorsByEntityId = useMemo(() => {
    const m = new Map<string, EntityError[]>();
    for (const e of visibleEntityErrors) {
      const existing = m.get(e.entityId);
      if (existing !== undefined) {
        existing.push(e);
      } else {
        m.set(e.entityId, [e]);
      }
    }
    return m;
  }, [visibleEntityErrors]);
  // Keep the ref in sync so cy-init closures and early-declared functions always
  // read the live index without re-running effects or causing stale-closure bugs.
  modelIndexRef.current = modelIndex;

  return (
    <div className="app">
      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {bannerVisible && (
        <div className="graph-global-banner" role="alert" ref={bannerRef}>
          <button
            className="graph-global-banner-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
          {findings.globalErrors.map((err, i) => (
            <div key={i} className="graph-global-banner-row">
              <strong>{RULES[err.ruleId]?.title ?? err.ruleId}:</strong>
              <span>{err.reason}</span>
            </div>
          ))}
        </div>
      )}

      {/* Shared: the container div that hosts both Cytoscape (ERD) and SVG (flow) */}
      <div className="graph-panel" ref={graphRef} />

      {/* ── GraphView — owns cy lifecycle, navigator, zoom adapter, hash wiring ── */}
      <GraphView
        ref={graphViewRef}
        containerRef={graphRef}
        minimapRef={minimapRef}
        isActive={view === 'graph'}
        model={model}
        themeMode={themeMode}
        modelIndex={modelIndex}
        findings={findings}
        layoutKey={layoutKeyRef.current}
        minimapOpen={minimapOpen}
        initialLayoutMode={layoutMode}
        searchMatches={graphSearchMatches}
        onCyReadyChange={setCyReady}
        onZoomPercentChange={setZoomPercent}
        onLayoutModeChange={setLayoutMode}
        onCyInitError={setCyInitError}
        onSelectEntity={(node) => {
          // Route graph node-tap through the shared opener so it pushes ONE
          // history entry (entity=). GraphView no longer writes entity= itself.
          setSelected(node);
          setShowEntityModal(true);
          openEntity(node.id);
        }}
        onPanelSelect={(node) => {
          // Findings-panel row click: pan+select in cy (done by GraphView) AND
          // open the entity modal so the row's issue is visible. Routes through
          // the single writer so entity= is pushed once and the URL stays truthful
          // (entity= ⟺ modal open).
          setSelected(node);
          setShowEntityModal(true);
          openEntity(node.id);
        }}
        onDeselectEntity={() => {
          // Background tap closes the modal and clears entity= from the URL
          // (replaceState — clean URL, not a Back step).
          setSelected(null);
          setShowEntityModal(false);
          closeEntity();
        }}
      />

      {/* ── DictionaryView (CP4) — keep-mounted via CSS hide; search + scroll survive detours ── */}
      {model ? (
        <div style={{ display: view === 'dict' ? 'block' : 'none' }}>
          <DictionaryView
            ref={dictViewRef}
            model={model}
            modelIndex={modelIndex}
            findings={findings}
            flowDiagrams={flowDiagrams}
            flowFindings={flowFindings}
            searchText={dictSearchText}
            onSearchChange={setDictSearchText}
            dictNavOpen={dictNavOpen}
            onToggleNav={() => setDictNavOpen(prev => !prev)}
            onOpenEntity={id => openEntityById(id)}
            themeMode={themeMode}
          />
        </div>
      ) : view === 'dict' ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--color-background)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          data-ignatius="dict-loading"
        >
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        </div>
      ) : null}

      {/* ── Flow surface: FlowsView owns FlowChrome chrome + the imperative SVG renderer ── */}
      <FlowsView
        ref={flowsViewRef}
        containerRef={graphRef}
        isActive={isFlowSurface}
        flowDiagrams={flowDiagrams}
        themeMode={themeMode}
        getEntityModel={() => entityModelRef.current}
        getThemeConfig={() => entityModelRef.current?.theme}
        onOpenEntity={(id, fromFlow) => openEntityByIdRef.current(id, fromFlow)}
        onZoomPercentChange={setFlowZoomPercent}
        searchTokens={flowSearchTokens}
      />

      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {view === 'graph' && minimapOpen && <div ref={minimapRef} id="minimap-panel" className="minimap" />}
      {/* Graph search bar (graph-flow-search CP2) — mounted while Graph view is active and a model is loaded. */}
      {view === 'graph' && model && (
        <SearchBar
          ref={graphSearchBarRef}
          term={graphSearchTerm}
          onTermChange={setGraphSearchTerm}
          includeBody={graphSearchIncludeBody}
          onIncludeBodyChange={setGraphSearchIncludeBody}
          matchCount={graphSearchActive ? graphSearchMatchIds.length : null}
          totalCount={model.nodes.length}
          onEnter={handleGraphSearchEnter}
          placeholder="Search entities…"
          ariaLabel="Search graph"
          className="viewer-search-bar--graph"
        />
      )}
      {/* Flow search bar (graph-flow-search CP3) — mounted while Flows view is active and diagrams exist. */}
      {view === 'flow' && (flowDiagrams?.length ?? 0) > 0 && (
        <SearchBar
          ref={flowSearchBarRef}
          term={flowSearchTerm}
          onTermChange={setFlowSearchTerm}
          includeBody={flowSearchIncludeBody}
          onIncludeBodyChange={setFlowSearchIncludeBody}
          matchCount={null}
          totalCount={0}
          onEnter={handleFlowSearchEnter}
          placeholder="Search flows…"
          ariaLabel="Search flows"
          className="viewer-search-bar--flow"
        >
          {flowSearchActive && (
            <FlowSearchResults results={flowSearchResults} onSelect={handleFlowSearchSelect} />
          )}
        </SearchBar>
      )}
      {/* Zoom control — Graph view: delegates to GraphView handle */}
      {view === 'graph' && cyReady && (
        <ZoomControl
          percent={zoomPercent}
          onZoomIn={() => graphViewRef.current?.zoomIn()}
          onZoomOut={() => graphViewRef.current?.zoomOut()}
          onSetPercent={(pct) => graphViewRef.current?.setPercent(pct)}
          onReset={() => graphViewRef.current?.resetZoom()}
        />
      )}
      {/* Zoom control — Flows view: delegates to FlowsView handle (CP23) */}
      {view === 'flow' && (flowDiagrams?.length ?? 0) > 0 && (
        <ZoomControl
          percent={flowZoomPercent}
          onZoomIn={() => flowsViewRef.current?.zoomIn()}
          onZoomOut={() => flowsViewRef.current?.zoomOut()}
          onSetPercent={(pct) => flowsViewRef.current?.setPercent(pct)}
          onReset={() => flowsViewRef.current?.resetZoom()}
        />
      )}
      {branding && (
        <div className="branding-block">
          {logoSrc && (
            <img className="branding-logo" src={logoSrc} alt={branding.title} />
          )}
          <div className="branding-text">
            <h1 className="branding-title">{branding.title}</h1>
            <p className="branding-subtitle">{branding.subtitle}</p>
          </div>
        </div>
      )}
      {/* ── Shared chrome: help, theme toggle, FAB (all views) ── */}
      <button className="help-toggle" onClick={() => setShowHelp(true)} title="What am I looking at? (?)" aria-label="Help">
        ?
      </button>
      <button className="theme-toggle" onClick={toggleTheme} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {themeMode === 'dark' ? '☀' : '☾'}
      </button>
      <FabMenu
        view={view}
        hasFlows={(flowDiagrams?.length ?? 0) > 0}
        groupEntries={groupEntries}
        layoutMode={layoutMode}
        minimapOpen={minimapOpen}
        onSetView={setView}
        onShowLegend={() => setShowLegend(true)}
        onShowGroups={() => setShowGroups(true)}
        onToggleMinimap={toggleMinimapOpen}
        onToggleLayoutMode={handleToggleLayoutMode}
        onResetLayout={() => {
          if (view === 'graph') graphViewRef.current?.resetLayout();
          else if (view === 'flow') flowsViewRef.current?.resetLayout();
        }}
        onToggleDictNav={() => setDictNavOpen(prev => !prev)}
      />
      {showGroups && (
        <Modal title="Groups" onClose={() => setShowGroups(false)}>
          {groupEntries.map(([name, cfg]) => (
            <div key={name} className="group-card">
              <div className="group-card-header">
                <span className="legend-swatch" style={{ background: cfg.color }} />
                <strong>{cfg.label}</strong>
              </div>
              {cfg.desc && (
                <div className="doc-body" dangerouslySetInnerHTML={{ __html: cfg.desc }} />
              )}
            </div>
          ))}
        </Modal>
      )}
      {showLegend && <LegendModal onClose={() => setShowLegend(false)} view={view} themeMode={themeMode} kindPalette={resolveFlowKindPalette(themeMode, model?.theme?.flowKinds)} />}
      {showHelp && <HelpModal view={view} onClose={() => setShowHelp(false)} />}
      {selected && showEntityModal && (
        <EntityModal
          selected={selected}
          model={model}
          nodeById={modelIndex?.nodeById}
          nodeIdSet={modelIndex?.nodeIdSet}
          entityErrors={appErrorsByEntityId.get(selected.id) ?? []}
          onClose={() => { setShowEntityModal(false); setEntityModalOpenedFromFlow(false); closeEntity(); }}
          onNavigate={(id) => {
            if (entityModalOpenedFromFlow) {
              // Flow context: open the target entity in-place (no graph pan).
              // Preserve the fromFlow flag so chained navigations stay in-place.
              // openEntityById pushes ONE history entry, so an FK hop A→B stacks
              // …→A→B and Back returns to A.
              openEntityById(id, true);
            } else {
              const target = modelIndexRef.current?.nodeById.get(id);
              if (target) {
                // Push the history entry for the modal switch (single writer),
                // then pan+select in cy. GraphView no longer writes entity=.
                setSelected(target);
                openEntity(id);
                graphViewRef.current?.navigateToEntity(id);
              }
            }
          }}
          processUsages={entityUsageIndex?.get(selected.id)}
          onNavigateToProcess={(processId) => {
            if (entityModalOpenedFromFlow && flowsViewRef.current) {
              // Flow context: open the target process dialog in-place over the flow.
              // Close entity modal first so only one dialog is visible at a time.
              setShowEntityModal(false);
              setEntityModalOpenedFromFlow(false);
              closeEntity();
              flowsViewRef.current.openFlowToken(`proc:${processId}`);
            } else {
              setShowEntityModal(false);
              closeEntity();
              // Record the target before setView so the dict-view useEffect picks it
              // up after React commits the view switch and the DOM is ready.
              pendingScrollProcessIdRef.current = processId;
              setView('dict');
            }
          }}
          allFlowNodeIds={entityModalOpenedFromFlow && appAllFlowNodeIds ? appAllFlowNodeIds : undefined}
        />
      )}
      {branding && (
        <footer className="branding-footer">
          <span className="branding-copyright">
            &copy; {branding.copyright.year} {branding.copyright.holder}
          </span>
          {branding.poweredBy && (
            <span className="branding-powered">
              powered by{' '}
              <a href="https://noorm.dev" target="_blank" rel="noopener noreferrer">
                Noorm
              </a>
            </span>
          )}
        </footer>
      )}
      <FindingsPanel
        globalErrors={
          view === 'flow'
            ? flowFindings.globalErrors
            : view === 'dict'
              ? [...findings.globalErrors, ...flowFindings.globalErrors]
              : findings.globalErrors
        }
        entityErrors={view === 'flow' ? [] : visibleEntityErrors}
        flowErrors={view === 'flow' || view === 'dict' ? flowFindings.flowErrors : undefined}
        collapsed={panelCollapsed}
        onCollapse={() => setPanelCollapsed(true)}
        onExpand={() => setPanelCollapsed(false)}
        onNavigate={(id) => graphViewRef.current?.panelNavigate(id)}
      />
    </div>
  );
}
