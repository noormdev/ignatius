import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { GroupConfig } from '../../../model/parse';
import type { ViewName, FlowViewMode, FlowCollapseLevel } from '../../hash-router';
import type { LayoutMode } from '../../views/graph/GraphView';
import { LAYOUT_MODE_NAME, nextLayoutMode } from '../../views/graph/graph-edits';

// Action wording names the target level, not just the next state's name — the
// stores→clusters/clusters→groups direction reads as "Collapse to X" and the
// groups→stores wrap reads as "Expand to X" since it un-collapses.
function collapseActionLabel(level: FlowCollapseLevel): string {
  switch (level) {
    case 'stores': return 'Collapse to clusters';
    case 'clusters': return 'Collapse to groups';
    case 'groups': return 'Expand to stores';
  }
}

export interface FabMenuProps {
  view: ViewName;
  hasFlows: boolean;
  groupEntries: [string, GroupConfig][];
  layoutMode: LayoutMode;
  minimapOpen: boolean;
  flowView: FlowViewMode;
  collapseLevel: FlowCollapseLevel;
  onSetView: (v: ViewName) => void;
  onShowLegend: () => void;
  onShowGroups: () => void;
  onShowSettings: () => void;
  /** Present in live mode only: a static export has no server to export from. */
  onExportHtml?: () => Promise<void>;
  onToggleMinimap: () => void;
  onToggleLayoutMode: () => void;
  onResetLayout: () => void;
  onToggleDictNav: () => void;
  onToggleFlowView: () => void;
  onCycleCollapseLevel: () => void;
}

/** Lets the Cmd/Ctrl+C shortcut share the menu's copy and its toast. */
export interface FabMenuHandle {
  copyLink(): void;
}

export const FabMenu = forwardRef<FabMenuHandle, FabMenuProps>(function FabMenu({
  view,
  hasFlows,
  groupEntries,
  layoutMode,
  minimapOpen,
  flowView,
  collapseLevel,
  onSetView,
  onShowLegend,
  onShowGroups,
  onShowSettings,
  onExportHtml,
  onToggleMinimap,
  onToggleLayoutMode,
  onResetLayout,
  onToggleDictNav,
  onToggleFlowView,
  onCycleCollapseLevel,
}, ref) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click or Esc
  useEffect(() => {
    if (!menuOpen) return;

    function onMouseDown(e: MouseEvent) {
      if (!(e.target instanceof Node)) return;
      const fab = fabRef.current;
      const menu = menuRef.current;
      if (!fab || !menu) return;
      if (!fab.contains(e.target) && !menu.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        fabRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
  }, []);

  function showToast(message: string, ms: number) {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(''), ms);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setMenuOpen(false);
      showToast('Copied!', 1500);
    });
  }

  useImperativeHandle(ref, () => ({ copyLink: handleCopyLink }));

  // Modal returns focus to whatever held it on mount; the clicked item unmounts with the menu.
  function openDialog(open: () => void) {
    setMenuOpen(false);
    fabRef.current?.focus();
    open();
  }

  function handleExportHtml(exportHtml: () => Promise<void>) {
    setMenuOpen(false);
    exportHtml().catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : String(err), 5000);
    });
  }

  return (
    <>
      <button
        ref={fabRef}
        className={`fab${menuOpen ? ' fab--open' : ''}`}
        onClick={() => setMenuOpen(prev => !prev)}
        title="Actions"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {groupEntries.length > 0 ? (
          <span className="fab-dots">
            {groupEntries.slice(0, 4).map(([name, cfg]) => (
              <span key={name} className="fab-dot" style={{ background: cfg.color }} />
            ))}
          </span>
        ) : (
          <span className="fab-icon">⋯</span>
        )}
      </button>
      {menuOpen && (
        <div ref={menuRef} className="fab-menu" role="menu">
          {/* View-switch items — shown for the other two views */}
          {view !== 'graph' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onSetView('graph'); }}
            >
              Data Graph <kbd className="kbd-hint">G</kbd>
            </button>
          )}
          {view !== 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onSetView('dict'); }}
            >
              Dictionary <kbd className="kbd-hint">D</kbd>
            </button>
          )}
          {view !== 'flow' && hasFlows && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onSetView('flow'); }}
            >
              Data Flows <kbd className="kbd-hint">F</kbd>
            </button>
          )}
          {/* Legend — graph and flow only; Dictionary has no node iconography to explain */}
          {view !== 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => openDialog(onShowLegend)}
            >
              Legend
            </button>
          )}
          {/* Graph-specific action items */}
          {view === 'graph' && (
            <>
              {groupEntries.length > 0 && (
                <button
                  className="fab-menu-item"
                  role="menuitem"
                  onClick={() => openDialog(onShowGroups)}
                >
                  Groups
                </button>
              )}
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { onToggleMinimap(); setMenuOpen(false); }}
              >
                {minimapOpen ? 'Hide minimap' : 'Show minimap'}
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onToggleLayoutMode(); }}
              >
                {LAYOUT_MODE_NAME[nextLayoutMode(layoutMode)]} layout <kbd className="kbd-hint">L</kbd>
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onResetLayout(); }}
              >
                Reset layout <kbd className="kbd-hint">R</kbd>
              </button>
            </>
          )}
          {/* Flow-specific action items */}
          {view === 'flow' && (
            <>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onToggleFlowView(); }}
              >
                {flowView === 'per-process' ? 'Connected view' : 'Per-process view'} <kbd className="kbd-hint">L</kbd>
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onCycleCollapseLevel(); }}
              >
                {collapseActionLabel(collapseLevel)}
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onResetLayout(); }}
              >
                Reset layout <kbd className="kbd-hint">R</kbd>
              </button>
            </>
          )}
          {/* Dict-specific action items */}
          {view === 'dict' && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onToggleDictNav(); }}
            >
              Toggle sidebar
            </button>
          )}
          <button
            className="fab-menu-item"
            role="menuitem"
            onClick={() => openDialog(onShowSettings)}
          >
            Settings
          </button>
          {onExportHtml && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => handleExportHtml(onExportHtml)}
            >
              Export HTML
            </button>
          )}
          {/* Copy link — graph, dict, and flow */}
          {(view === 'graph' || view === 'dict' || view === 'flow') && (
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={handleCopyLink}
            >
              Copy link
            </button>
          )}
        </div>
      )}
      <div className="fab-toast" role="status">{toast}</div>
    </>
  );
});
