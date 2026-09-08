import { useEffect, useRef, useState } from 'react';
import type { GroupConfig } from '../../../model/parse';
import type { ViewName, FlowViewMode, FlowCollapseLevel } from '../../hash-router';
import type { LayoutMode } from '../../views/graph/GraphView';

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
  onToggleMinimap: () => void;
  onToggleLayoutMode: () => void;
  onResetLayout: () => void;
  onToggleDictNav: () => void;
  onToggleFlowView: () => void;
  onCycleCollapseLevel: () => void;
}

export function FabMenu({
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
  onToggleMinimap,
  onToggleLayoutMode,
  onResetLayout,
  onToggleDictNav,
  onToggleFlowView,
  onCycleCollapseLevel,
}: FabMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState(false);
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

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopyConfirm(true);
      setMenuOpen(false);
      setTimeout(() => setCopyConfirm(false), 1500);
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
              onClick={() => { setMenuOpen(false); onShowLegend(); }}
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
                  onClick={() => { setMenuOpen(false); onShowGroups(); }}
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
                {layoutMode === 'organic' ? 'Hierarchical layout' : 'Organic layout'} <kbd className="kbd-hint">L</kbd>
              </button>
              <button
                className="fab-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onResetLayout(); }}
              >
                Reset layout
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
                {flowView === 'per-process' ? 'Connected view' : 'Per-process view'}
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
                Reset layout
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
      {copyConfirm && (
        <div className="fab-copy-toast">Copied!</div>
      )}
    </>
  );
}
