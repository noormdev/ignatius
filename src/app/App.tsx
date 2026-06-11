import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { semanticColors, resolveFlowKindPalette, type FlowKindKey, type FlowKindEntry } from '../theme/theme-defaults';
import type { ViewName } from './hash-router';
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
import { Modal } from './components/ui/Modal';
import { ZoomControl } from './components/ui/ZoomControl';
import { EntityModal } from './components/entity/EntityModal';
import { FindingsPanel } from './components/findings/FindingsPanel';
import { LegendModal } from './views/flow/LegendModal';
import { FlowsView } from './views/flow/FlowsView';
import type { FlowsViewHandle } from './views/flow/FlowsView';
import { DictionaryView } from './views/dict/DictionaryView';
import { GraphView } from './views/graph/GraphView';
import type { GraphViewHandle, LayoutMode } from './views/graph/GraphView';
import { FabMenu } from './components/ui/FabMenu';
import { useModelData } from './hooks/useModelData';
import { useHashRoute } from './hooks/useHashRoute';
import { useThemeMode } from './hooks/useThemeMode';

export function App() {
  const graphRef = useRef<HTMLDivElement>(null);
  // Handle to GraphView — provides navigateToEntity, panelNavigate, resetLayout,
  // applyLayoutMode, zoom ops, retheme.
  const graphViewRef = useRef<GraphViewHandle>(null);
  // Minimap container: rendered in shell JSX, ref passed down to GraphView.
  const minimapRef = useRef<HTMLDivElement>(null);

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

  const { view, setView } = useHashRoute({
    onRestoreDfd: (dfdId) => flowsViewRef.current?.selectDiagramById(dfdId),
  });

  const { themeMode, toggleTheme } = useThemeMode(model?.theme, model);

  // Zoom readout for the Flows view ZoomControl — updated by FlowsView via onZoomPercentChange.
  const [flowZoomPercent, setFlowZoomPercent] = useState(100);
  // Lifted from GraphView via onCyInitError — shell renders the error fallback.
  const [cyInitError, setCyInitError] = useState<string | null>(null);
  const [showEntityModal, setShowEntityModal] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    return localStorage.getItem('ignatius-minimap') === 'true';
  });
  // Lifted from GraphView via onCyReadyChange — shell gates ZoomControl/minimap rendering.
  const [cyReady, setCyReady] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Dictionary state — keep-mounted so search text + scroll survive view switches.
  const [dictSearchText, setDictSearchText] = useState('');
  const [dictNavOpen, setDictNavOpen] = useState(false);
  // Pending scroll target: set by onNavigateToProcess, consumed by the view-switch
  // useEffect once the dict container is visible and the process anchor exists.
  const pendingScrollProcessIdRef = useRef<string | null>(null);
  // Pan-free entity opener: selects the node and shows the rich SelectedEntityModal
  // WITHOUT panning the graph. Used by the flow viewer's db: store ⓘ badge so the
  // rich dialog opens even when the ERD graph is not mounted (flow surface).
  //
  // `fromFlow` marks the context: when true, the modal's FK/body/process-usage links
  // navigate in-place via the FlowsView handle instead of switching views.
  function openEntityById(id: string, fromFlow = false) {
    const node = modelIndexRef.current?.nodeById.get(id);
    if (node) {
      setEntityModalOpenedFromFlow(fromFlow);
      setSelected(node);
      setShowEntityModal(true);
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

  function toggleMinimapOpen() {
    const next = !minimapOpen;
    localStorage.setItem('ignatius-minimap', String(next));
    setMinimapOpen(next);
  }

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

  const showBanner = !bannerDismissed && findings.globalErrors.length > 0;
  const isFlowSurface = view === 'flow';

  return (
    <div className="app">
      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {!isFlowSurface && showBanner && (
        <div className="graph-global-banner" role="alert">
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
        onCyReadyChange={setCyReady}
        onZoomPercentChange={setZoomPercent}
        onLayoutModeChange={setLayoutMode}
        onCyInitError={setCyInitError}
        onSelectEntity={(node) => {
          setSelected(node);
          setShowEntityModal(true);
        }}
        onPanelSelect={(node) => {
          setSelected(node);
        }}
        onDeselectEntity={() => {
          setSelected(null);
          setShowEntityModal(false);
        }}
      />

      {/* ── DictionaryView (CP4) — keep-mounted via CSS hide; search + scroll survive detours ── */}
      {model ? (
        <div style={{ display: view === 'dict' ? 'block' : 'none' }}>
          <DictionaryView
            model={model}
            modelIndex={modelIndex}
            findings={findings}
            flowDiagrams={flowDiagrams}
            flowFindings={flowFindings}
            searchText={dictSearchText}
            onSearchChange={setDictSearchText}
            dictNavOpen={dictNavOpen}
            onToggleNav={() => setDictNavOpen(prev => !prev)}
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
      />

      {/* ── ERD surface chrome (hidden on flow surface) ── */}
      {view === 'graph' && minimapOpen && <div ref={minimapRef} id="minimap-panel" className="minimap" />}
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
      {/* ── Shared chrome: theme toggle, FAB (all views) ── */}
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
        onToggleLayoutMode={() => {
          const next = layoutMode === 'organic' ? 'hierarchical' : 'organic';
          setLayoutMode(next);
          localStorage.setItem('ignatius-layout-mode', next);
          graphViewRef.current?.applyLayoutMode(next);
        }}
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
      {selected && showEntityModal && (
        <EntityModal
          selected={selected}
          model={model}
          nodeById={modelIndex?.nodeById}
          nodeIdSet={modelIndex?.nodeIdSet}
          entityErrors={appErrorsByEntityId.get(selected.id) ?? []}
          onClose={() => { setShowEntityModal(false); setEntityModalOpenedFromFlow(false); }}
          onNavigate={(id) => {
            if (entityModalOpenedFromFlow) {
              // Flow context: open the target entity in-place (no graph pan).
              // Preserve the fromFlow flag so chained navigations stay in-place.
              openEntityById(id, true);
            } else {
              const target = modelIndexRef.current?.nodeById.get(id);
              if (target) {
                setSelected(target);
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
              flowsViewRef.current.openFlowToken(`proc:${processId}`);
            } else {
              setShowEntityModal(false);
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
