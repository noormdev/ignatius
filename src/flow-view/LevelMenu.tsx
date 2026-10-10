/**
 * LevelMenu.tsx — the dropdown a breadcrumb's ▾ opens: every diagram at that
 * crumb's level, with its number, description, and process count, so a user
 * can switch sideways without climbing back up.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeReview } from '../model/change-review';
import { flowRowChanges, type FlowRowChanges } from '../app/logic/change-marks';
import { ChangeDot } from '../app/components/changes/ChangeBadge';
import type { FlowLevelEntry } from './flow-nav';

// Below this many entries every row fits without scrolling, so a filter box
// would only add a step.
const FILTER_MIN_ENTRIES = 8;

export function LevelMenu({ heading, entries, currentId, parentIds, changeReview, onPick, onClose }: {
  heading: string;
  entries: FlowLevelEntry[];
  currentId: string;
  /** Id path of the diagram the entries decompose, root first; empty for the roots. */
  parentIds: string[];
  /** Changes to mark on the rows; null = no marks. */
  changeReview: ChangeReview | null;
  onPick: (entry: FlowLevelEntry) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  const shown = term
    ? entries.filter(e => `${e.number} ${e.label} ${e.description ?? ''}`.toLowerCase().includes(term))
    : entries;
  const [activeIdx, setActiveIdx] = useState(() => Math.max(0, entries.findIndex(e => e.diagramId === currentId)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const showFilter = entries.length > FILTER_MIN_ENTRIES;
  const parentKey = parentIds.join('/');
  const changesById = useMemo(() => {
    const changes = new Map<string, FlowRowChanges>();
    if (!changeReview) return changes;
    for (const entry of entries) {
      changes.set(entry.diagramId, flowRowChanges(changeReview, parentKey ? `${parentKey}/${entry.diagramId}` : entry.diagramId, true));
    }
    return changes;
  }, [entries, parentKey, changeReview]);

  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
    else listRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')?.focus();
    // Focus once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, term]);

  useEffect(() => {
    // The menu renders inside its crumb, so its parent holds the ▾ that
    // opened it; a press there is left to that button's own toggle.
    function onPointerDown(ev: PointerEvent) {
      if (ev.target instanceof Node && rootRef.current?.parentElement?.contains(ev.target)) return;
      onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  function onKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      onClose();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      if (shown.length === 0) return;
      const step = ev.key === 'ArrowDown' ? 1 : -1;
      setActiveIdx(i => (Math.min(i, shown.length - 1) + step + shown.length) % shown.length);
    } else if (ev.key === 'Enter') {
      const entry = shown[Math.min(activeIdx, shown.length - 1)];
      if (entry) {
        ev.preventDefault();
        onPick(entry);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className="flow-level-menu"
      data-ignatius="flow-level-menu"
      role="dialog"
      aria-label={heading}
      onKeyDown={onKeyDown}
    >
      <div className="flow-level-menu__head">{heading} · {entries.length}</div>
      {showFilter && (
        <input
          ref={filterRef}
          className="flow-level-menu__filter"
          placeholder="Filter…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setActiveIdx(0); }}
        />
      )}
      <ul ref={listRef} className="flow-level-menu__list" role="listbox" aria-label={heading}>
        {shown.map((entry, i) => {
          const isCurrent = entry.diagramId === currentId;
          const isActive = i === Math.min(activeIdx, shown.length - 1);
          const changes = changesById.get(entry.diagramId);
          return (
            <li key={entry.diagramId} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isCurrent}
                data-active={isActive}
                data-ignatius="flow-level-menu-item"
                className={`flow-level-menu__item${isCurrent ? ' flow-level-menu__item--current' : ''}${isActive ? ' flow-level-menu__item--active' : ''}`}
                onClick={() => onPick(entry)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="flow-level-menu__num">{entry.number}</span>
                <span className="flow-level-menu__label">
                  {entry.label}{isCurrent ? ' ✓' : ''}
                  <ChangeDot severity={changes?.inside ?? null} mark={changes?.mark} />
                </span>
                <span className="flow-level-menu__count">
                  {entry.processCount} {entry.processCount === 1 ? 'process' : 'processes'}
                </span>
                {entry.description && <span className="flow-level-menu__desc">{entry.description}</span>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="flow-level-menu__empty">No match.</li>}
      </ul>
    </div>
  );
}
