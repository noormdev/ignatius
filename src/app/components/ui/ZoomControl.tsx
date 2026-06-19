import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// View-agnostic zoom control: receives a zoom percentage + four handlers.
// No cytoscape or SVG internals inside — each view supplies its own adapter.
// 100% = native 1:1 — one diagram unit renders as one CSS pixel, independent of
// model size (#3 viewer-ux-polish). The readout shows the true scale, so the
// initial fit-to-screen view reads its real percent (e.g. ~42% on a large
// model). The reset/⌂ button still fits-to-screen.

export interface ZoomControlProps {
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetPercent: (pct: number) => void;
  onReset: () => void;
}

export function ZoomControl({ percent, onZoomIn, onZoomOut, onSetPercent, onReset }: ZoomControlProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function commitDraft() {
    setEditing(false);
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onSetPercent(parsed);
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitDraft();
    if (e.key === 'Escape') setEditing(false);
  }

  function startEdit() {
    setDraft(String(percent));
    setEditing(true);
  }

  return (
    <div className="zoom-control" data-testid="zoom-control">
      <button className="zoom-control-btn" onClick={onZoomOut} title="Zoom out (−10%)" aria-label="Zoom out">−</button>
      {editing ? (
        <input
          className="zoom-control-input"
          type="text"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
          aria-label="Zoom percent"
        />
      ) : (
        <button
          className="zoom-control-readout"
          onClick={startEdit}
          title="Click to set zoom percent"
          aria-label={`Current zoom ${percent}%, click to edit`}
        >
          {percent}%
        </button>
      )}
      <button className="zoom-control-btn" onClick={onZoomIn} title="Zoom in (+10%)" aria-label="Zoom in">+</button>
      <button className="zoom-control-reset" onClick={onReset} title="Fit to screen" aria-label="Fit to screen">⌂</button>
    </div>
  );
}
