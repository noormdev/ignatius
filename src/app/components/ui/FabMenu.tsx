import { useEffect, useRef, useState } from 'react';
import type { GroupConfig } from '../../../model/parse';
import type { ViewName } from '../../hash-router';
import type { LayoutMode } from '../../views/graph/GraphView';

export interface FabMenuProps {
  view: ViewName;
  hasFlows: boolean;
  groupEntries: [string, GroupConfig][];
  layoutMode: LayoutMode;
  minimapOpen: boolean;
  onSetView: (v: ViewName) => void;
  onShowLegend: () => void;
  onShowGroups: () => void;
  onToggleMinimap: () => void;
  onToggleLayoutMode: () => void;
  onResetLayout: () => void;
  onToggleDictNav: () => void;
}

export function FabMenu({
  view,
  hasFlows,
  groupEntries,
  layoutMode,
  minimapOpen,
  onSetView,
  onShowLegend,
  onShowGroups,
  onToggleMinimap,
  onToggleLayoutMode,
  onResetLayout,
  onToggleDictNav,
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
            <button
              className="fab-menu-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); onResetLayout(); }}
            >
              Reset layout
            </button>
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
          {/* Copy link — graph and dict */}
          {(view === 'graph' || view === 'dict') && (
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
