import { useEffect, useRef, useState } from 'react';
import type { ChangeClaim, ChangeItem, ChangeReview, ReviewedItem } from '../../../model/change-review';
import type { FlowDiagram } from '../../../flows/flow-parse';
import { SYNTHETIC_DIAGRAM_IDS } from '../../../flows/flow-derive-levels';

// The SSE refresh normally clears "Approving…"; this covers a missed event.
const APPROVE_REFRESH_MS = 5_000;

function fieldList(fields: string[] | undefined): string {
  return fields && fields.length > 0 ? ` (${fields.join(', ')})` : '';
}

type FlowItem = Extract<ChangeItem, { scope: 'flow' }>;

/** Diagram titles and the node's display label, falling back to ids for what the current flows no longer hold. */
function flowNames(item: FlowItem, diagrams: FlowDiagram[] | null): { diagram: string; node?: string } {
  const titles: string[] = [];
  let level = diagrams ?? [];
  let found: FlowDiagram | undefined;
  for (const id of item.diagramPath.split('/')) {
    found = level.find(d => d.id === id);
    if (!SYNTHETIC_DIAGRAM_IDS.has(id)) titles.push(found?.title ?? id);
    level = found?.subDfds ?? [];
  }
  const diagram = titles.join(' / ');
  const node = item.node;
  if (node === undefined) return { diagram };
  const label = item.nodeKind === 'process' ? found?.processes.find(p => p.id === node)?.label
    : item.nodeKind === 'external' ? found?.externals.find(e => e.id === node)?.label
    : found?.storeRefs.find(s => s.name === node && s.kind === item.storeKind)?.displayName;
  return { diagram, node: label ?? node };
}

/** The label before the change kind, so a row can style the kind on its own. */
function labelSubject(item: ChangeItem, diagrams: FlowDiagram[] | null): string {
  switch (item.scope) {
    case 'entity':
      return `${item.entity} — entity`;
    case 'column':
      return `${item.entity}.${item.column} — column`;
    case 'relationship':
      return `${item.source} → ${item.target} (${Object.keys(item.on).join(', ')}) — relationship`;
    case 'doc':
      return `${item.entity} — body`;
    case 'flow': {
      const names = flowNames(item, diagrams);
      return names.node === undefined
        ? `${names.diagram} — diagram`
        : `${names.diagram} / ${names.node} — ${item.nodeKind ?? 'node'}`;
    }
  }
}

export function itemLabel(item: ChangeItem, diagrams: FlowDiagram[] | null): string {
  return `${labelSubject(item, diagrams)} ${item.kind}${fieldList('fields' in item ? item.fields : undefined)}`;
}

function claimLabel(claim: ChangeClaim): string {
  const target = 'entity' in claim
    ? (claim.column === undefined ? claim.entity : `${claim.entity}.${claim.column}`)
    : (claim.node === undefined ? claim.diagram : `${claim.diagram} / ${claim.node}`);
  return `${target} — named in ${claim.note}, unchanged`;
}

/** The change review as notes, unexplained items, unchanged claims, and note errors; renders nothing when empty. */
export function ChangesPanel({
  review,
  flowDiagrams,
  overlay,
  onOverlayChange,
  collapsed,
  onCollapse,
  onExpand,
  onNavigateEntity,
  onOpenDiagram,
  onRefresh,
}: {
  review: ChangeReview;
  flowDiagrams: FlowDiagram[] | null;
  overlay: boolean;
  onOverlayChange: (on: boolean) => void;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onNavigateEntity: (entityId: string) => void;
  /** Takes a `diagramPath`, which `FlowsView.selectDiagramById` resolves. */
  onOpenDiagram: (diagramPath: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(refreshTimer.current);
    setApproving(false);
    setApproveError(null);
  }, [review]);

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const { items, claims, notes, noteErrors } = review;
  if (items.length + claims.length + notes.length + noteErrors.length === 0) return null;

  async function approve() {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch('/api/approve', { method: 'POST' });
      if (!res.ok) {
        setApproving(false);
        setApproveError(`Approve failed: ${res.status} ${res.statusText}`);
        return;
      }
      refreshTimer.current = setTimeout(() => {
        onRefresh()
          .catch(err => setApproveError(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`))
          .finally(() => setApproving(false));
      }, APPROVE_REFRESH_MS);
    } catch (err) {
      setApproving(false);
      setApproveError(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function openItem(item: ReviewedItem) {
    if (item.scope === 'flow') onOpenDiagram(item.diagramPath);
    else onNavigateEntity(item.scope === 'relationship' ? item.source : item.entity);
  }

  function itemRow(item: ReviewedItem) {
    let key = itemLabel(item, null);
    if (item.scope === 'flow') key = [item.diagramPath, item.nodeKind, item.storeKind, item.node, item.kind].join('|');
    else if (item.scope === 'relationship') key = `${key}|${JSON.stringify(item.on)}`;
    const className = `changes-panel-item changes-panel-item--${item.kind}`;
    // A removed diagram has nowhere to open.
    const openable = !(item.scope === 'flow' && item.node === undefined && item.kind === 'removed');
    const content = item.kind === 'removed'
      ? (
        <>
          <span className="changes-panel-removed-icon" aria-hidden="true" />
          {labelSubject(item, flowDiagrams)} <span className="changes-panel-removed">removed</span>
        </>
      )
      : itemLabel(item, flowDiagrams);
    return (
      <li key={key}>
        {openable
          ? <button className={className} onClick={() => openItem(item)}>{content}</button>
          : <span className={className}>{content}</span>}
      </li>
    );
  }

  function itemList(list: ReviewedItem[]) {
    return <ul className="changes-panel-items">{list.map(itemRow)}</ul>;
  }

  const toReview = items.length + claims.length + noteErrors.length;

  if (collapsed) {
    return (
      <aside className="side-panel side-panel--collapsed changes-panel">
        <button className="side-panel-badge changes-panel-badge" onClick={onExpand}>
          {toReview} to review
        </button>
      </aside>
    );
  }

  const unexplained = items.filter(item => item.status === 'unexplained');

  return (
    <aside className="side-panel changes-panel">
      <header className="side-panel-header changes-panel-header">
        <h3>Changes ({toReview} to review)</h3>
        <button className="side-panel-collapse" onClick={onCollapse} aria-label="Collapse panel">
          −
        </button>
      </header>
      <div className="changes-panel-actions">
        <label className="changes-panel-overlay">
          <input type="checkbox" checked={overlay} onChange={e => onOverlayChange(e.target.checked)} />
          Highlight changes
        </label>
        {window.__IGNATIUS_MODE__ !== 'static' && (
          <button className="changes-panel-approve" onClick={approve} disabled={approving}>
            {approving ? 'Approving…' : 'Approve'}
          </button>
        )}
      </div>
      {approveError && <p className="changes-panel-error" role="alert">{approveError}</p>}
      <div className="changes-panel-body">
        {notes.length > 0 && (
          <section className="changes-panel-section changes-panel-section--notes">
            {notes.map(note => (
              <article key={note.file} className="changes-panel-note">
                <h4>{note.title}</h4>
                <div className="doc-body" dangerouslySetInnerHTML={{ __html: note.bodyHtml }} />
                {itemList(items.filter(item => item.notes.includes(note.file)))}
              </article>
            ))}
          </section>
        )}
        {unexplained.length > 0 && (
          <section className="changes-panel-section changes-panel-section--unexplained">
            <h4>Unexplained ({unexplained.length})</h4>
            {itemList(unexplained)}
          </section>
        )}
        {claims.length > 0 && (
          <section className="changes-panel-section changes-panel-section--claims">
            <h4>Named but unchanged ({claims.length})</h4>
            <ul className="changes-panel-items">
              {claims.map(claim => {
                const label = claimLabel(claim);
                return <li key={label} className="changes-panel-text">{label}</li>;
              })}
            </ul>
          </section>
        )}
        {noteErrors.length > 0 && (
          <section className="changes-panel-section changes-panel-section--errors">
            <h4>Note errors ({noteErrors.length})</h4>
            <ul className="changes-panel-items">
              {noteErrors.map(err => <li key={err.file} className="changes-panel-text">{err.file}: {err.error}</li>)}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
