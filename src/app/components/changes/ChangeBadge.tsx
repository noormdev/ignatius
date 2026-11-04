import { useEffect, useRef, useState } from 'react';
import type { ChangeMark, ChangeSeverity, ExplainedChanges } from '../../logic/change-marks';
import type { FlowDiagram } from '../../../flows/flow-parse';
import { itemLabel } from './ChangesPanel';

const POPOVER_WIDTH = 440;
const POPOVER_HEIGHT = 360;
const GAP = 6;
const EDGE = 8;

type Placement = { left: number; width: number; maxHeight: number } & ({ top: number } | { bottom: number });

/** Below the badge when it fits, else on whichever side has more room; clamped to the viewport. */
function placeBeside(badge: DOMRect): Placement {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(badge.left, window.innerWidth - width - EDGE));
  const below = window.innerHeight - badge.bottom - GAP - EDGE;
  const above = badge.top - GAP - EDGE;
  if (below >= POPOVER_HEIGHT || below >= above) return { left, width, maxHeight: Math.min(POPOVER_HEIGHT, below), top: badge.bottom + GAP };
  return { left, width, maxHeight: Math.min(POPOVER_HEIGHT, above), bottom: window.innerHeight - badge.top + GAP };
}

/** An entity's or flow node's change mark. Given `changes`, the badge is a button that opens a popover listing what
 *  changed and the notes that explain it; `diagrams` names flow items by title. */
export function ChangeBadge({ mark, changes, diagrams = null }: { mark: ChangeMark | undefined; changes?: ExplainedChanges; diagrams?: FlowDiagram[] | null }) {
  // Fixed to the viewport: an entity modal clips anything absolute that crosses its edge.
  const [placement, setPlacement] = useState<Placement | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const open = placement !== null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setPlacement(null);
    }
    // The popover is fixed to the viewport, so a scroll behind it moves it with its badge, and closes it once the badge leaves the window.
    function onScroll(e: Event) {
      const root = rootRef.current;
      if (!root || (e.target instanceof Node && root.contains(e.target))) return;
      const badge = root.getBoundingClientRect();
      setPlacement(badge.bottom < 0 || badge.top > window.innerHeight ? null : placeBeside(badge));
    }
    // Capture phase, so Escape closes the popover before the entity modal's own Escape handler sees it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPlacement(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  function toggle(button: HTMLElement) {
    setPlacement(open ? null : placeBeside(button.getBoundingClientRect()));
  }

  if (!mark) return null;
  const className = `change-badge change-badge--${mark.change}${mark.unexplained ? ' change-badge--unexplained' : ''}`;
  const text = `${mark.change}${mark.unexplained ? ' · unexplained' : ''}`;
  if (!changes || changes.items.length === 0) {
    return (
      <span className={className} title={mark.unexplained ? 'Not covered by a change note' : undefined}>
        {text}
      </span>
    );
  }

  return (
    <span className="change-badge-anchor" ref={rootRef}>
      <button
        type="button"
        className={`${className} change-badge--button`}
        aria-expanded={open}
        title="Why did this change?"
        onClick={e => {
          e.stopPropagation();
          toggle(e.currentTarget);
        }}
      >
        {text} ▾
      </button>
      {placement && <ChangePopover changes={changes} placement={placement} diagrams={diagrams} />}
    </span>
  );
}

function ChangePopover({ changes, placement, diagrams }: { changes: ExplainedChanges; placement: Placement; diagrams: FlowDiagram[] | null }) {
  return (
    <div className="change-popover" style={placement} role="dialog" aria-label="Why this changed" data-ignatius="change-popover">
      <h4>What changed</h4>
      <ul className="change-popover-items">
        {changes.items.map((item, i) => (
          <li key={i}>
            {itemLabel(item, diagrams)}
            {item.status === 'unexplained' && <span className="change-popover-unexplained"> · no note covers this</span>}
          </li>
        ))}
      </ul>
      <h4>Why</h4>
      {changes.notes.length === 0 ? (
        <p className="change-popover-empty">No change note covers these changes.</p>
      ) : (
        changes.notes.map(note => (
          <section key={note.file} className="change-popover-note">
            <div className="change-popover-note-title">
              {note.title} <code>{note.file}</code>
            </div>
            <div className="md" dangerouslySetInnerHTML={{ __html: note.bodyHtml }} />
          </section>
        ))
      )}
    </div>
  );
}

/** A static dot colored by the worst change inside a flow index or level menu row's diagram,
 *  or, given the row's own `mark`, a dot that pulses in its kind color. */
export function ChangeDot({ severity, mark = null }: { severity: ChangeSeverity | null; mark?: ChangeMark | null }) {
  if (mark) {
    const label = `${mark.change === 'added' ? 'Added' : 'Changed'}${mark.unexplained ? ', not covered by a change note' : ''}`;
    return (
      <span
        className="change-dot change-dot--pulse"
        data-ignatius="flow-change-dot"
        data-change={mark.change}
        data-unexplained={mark.unexplained ? 'true' : undefined}
        role="img"
        aria-label={label}
        title={label}
      />
    );
  }
  if (!severity) return null;
  const label = severity === 'unexplained' ? 'Contains changes no note covers' : 'Contains changes';
  return (
    <span
      className={`change-dot change-dot--${severity}`}
      data-ignatius="flow-change-dot"
      data-severity={severity}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
