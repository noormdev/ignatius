import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GraphEditState } from '../../views/graph/graph-edits';

export interface GraphEditBarProps {
  state: GraphEditState;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSelectMode: () => void;
  /** null = show every hidden node. */
  onShowHidden: (ids: string[] | null) => void;
}

// Stroke paths from Lucide (ISC).
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="graph-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const UndoIcon = () => <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>;
const RedoIcon = () => <Icon><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>;
const SelectIcon = () => (
  <Icon>
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
    <path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M5 21a2 2 0 0 1-2-2" />
    <path d="M9 3h1" /><path d="M9 21h2" /><path d="M14 3h1" /><path d="M3 9v1" /><path d="M21 9v2" /><path d="M3 14v1" />
  </Icon>
);
const EyeOffIcon = () => (
  <Icon>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </Icon>
);
const EyeIcon = () => (
  <Icon>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export function GraphEditBar({ state, onUndo, onRedo, onToggleSelectMode, onShowHidden }: GraphEditBarProps) {
  const [listOpen, setListOpen] = useState(false);
  const hiddenCount = state.hidden.length;
  // The count can reach 0 without the list (undo, search, a deep link); close
  // it then, or the next hide would reopen it unasked.
  if (listOpen && hiddenCount === 0) setListOpen(false);
  const open = listOpen && hiddenCount > 0;

  return (
    <div className="graph-edit-bar" data-testid="graph-edit-bar">
      <button className="graph-edit-btn" onClick={onUndo} disabled={!state.canUndo} title="Undo (⌘/Ctrl Z)" aria-label="Undo">
        <UndoIcon />
      </button>
      <button className="graph-edit-btn" onClick={onRedo} disabled={!state.canRedo} title="Redo (⌘/Ctrl ⇧ Z)" aria-label="Redo">
        <RedoIcon />
      </button>
      <span className="graph-edit-sep" aria-hidden="true" />
      <button
        className="graph-edit-btn"
        onClick={onToggleSelectMode}
        aria-pressed={state.selectMode}
        title={state.selectMode ? 'Select mode: drag to box-select, click to add or remove (S)' : 'Select mode (S)'}
        aria-label="Select mode"
      >
        <SelectIcon />
      </button>
      <span className="graph-edit-sep" aria-hidden="true" />
      <button
        className="graph-edit-btn graph-edit-hidden"
        onClick={() => setListOpen(!listOpen)}
        disabled={hiddenCount === 0}
        aria-expanded={open}
        title={hiddenCount === 0 ? 'No hidden entities (right-click one to hide it)' : 'Hidden entities'}
        aria-label={`${hiddenCount} hidden`}
      >
        <EyeOffIcon />
        <span className="graph-edit-count">{hiddenCount}</span>
      </button>
      {open && (
        <div className="graph-edit-popover" role="dialog" aria-label="Hidden entities">
          <div className="graph-edit-popover-head">
            <span>Hidden <span className="graph-edit-popover-count">{hiddenCount}</span></span>
            <button className="graph-edit-link" onClick={() => { onShowHidden(null); setListOpen(false); }}>Show all</button>
          </div>
          <ul>
            {state.hidden.map(id => (
              <li key={id}>
                <span className="graph-edit-popover-name" title={id}>{id}</span>
                <button
                  className="graph-edit-btn"
                  onClick={() => onShowHidden([id])}
                  title={`Show ${id}`}
                  aria-label={`Show ${id}`}
                >
                  <EyeIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
