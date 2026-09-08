import type { FlowProcess, FlowEdge, FlowEndpoint } from '../../../flows/flow-parse';
import { KindMarker } from './KindMarker';

/** One resolved Data-cell for an IoTable row. `isColumn` renders as `<code>`. */
export type IoRowCell = { text: string; isColumn: boolean };

/**
 * Pure: resolves the Data-cell value(s) for one IoTable row. A `db:` entry
 * with a `label:` collapses to a single labelled row instead of one row per
 * column; an unlabelled `db:` entry keeps one row per column (or a single
 * '—' row when `data:` is empty). A non-db entry is always a single row —
 * its label (when present) replaces the joined column-preview text.
 * No React import — exercised directly by unit tests.
 */
export function resolveIoRowCells(edge: FlowEdge, otherEp: FlowEndpoint): IoRowCell[] {
  if (otherEp.kind === 'db') {
    if (edge.label) return [{ text: edge.label, isColumn: false }];
    const dataColumns: string[] = Array.isArray(edge.data)
      ? edge.data
      : edge.data.length > 0 ? [edge.data] : [];
    if (dataColumns.length === 0) return [{ text: '—', isColumn: false }];
    return dataColumns.map(col => ({ text: col, isColumn: true }));
  }
  const dataLabel = edge.label ?? (Array.isArray(edge.data) ? edge.data.join(', ') : edge.data);
  return [{ text: dataLabel || '—', isColumn: false }];
}

export function IoTable({
  process,
  allProcesses,
  onScrollToEntity,
  onOpenEntity,
  onOpenToken,
  canOpenToken,
}: {
  process: FlowProcess;
  allProcesses: FlowProcess[];
  onScrollToEntity: (entityId: string) => void;
  /** When provided, db: entity links open the rich entity dialog instead of scrolling. */
  onOpenEntity?: (entityId: string) => void;
  /** When provided, non-db endpoints whose token resolves open in-place via the flow resolver. */
  onOpenToken?: (token: string) => void;
  /** Returns true when a given token resolves to a known flow node (used to avoid dead links). */
  canOpenToken?: (token: string) => boolean;
}) {
  const hasFlows = process.inputs.length > 0 || process.outputs.length > 0;
  if (!hasFlows) {
    return <p className="flow-no-flows">No flows defined for this process.</p>;
  }

  function renderRow(edge: FlowEdge, direction: 'in' | 'out') {
    const otherEp = direction === 'in' ? edge.from : edge.to;
    const dirLabel = direction;

    if (otherEp.kind === 'db') {
      const entityId = otherEp.name;

      // When onOpenEntity is provided (dialog context), render as a rich entity
      // link with data-entity so a click opens the SelectedEntityModal. Otherwise
      // fall back to the dict scroll-to-anchor behavior.
      function renderEntityCell() {
        if (onOpenEntity) {
          return (
            <a
              href={`#entity-${entityId}`}
              className="entity-link"
              data-entity={entityId}
              onClick={e => { e.preventDefault(); onOpenEntity(entityId); }}
            >
              {entityId}
            </a>
          );
        }
        return (
          <a href={`#entity-${entityId}`} onClick={e => { e.preventDefault(); onScrollToEntity(entityId); }}>
            {entityId}
          </a>
        );
      }

      return resolveIoRowCells(edge, otherEp).map((cell, i) => (
        <tr key={`${direction}-${entityId}-${cell.text}-${i}`}>
          <td>{renderEntityCell()}</td>
          <td><KindMarker ep={otherEp} processes={allProcesses} /></td>
          <td>{cell.isColumn ? <code>{cell.text}</code> : cell.text}</td>
          <td>{dirLabel}</td>
        </tr>
      ));
    }

    // Build the kind-qualified token for this endpoint so the flow resolver can
    // check whether it maps to a known node (ext:, file:, cache:, etc.).
    const epToken = `${otherEp.kind}:${otherEp.name}`;
    const isResolvable = onOpenToken !== undefined && canOpenToken?.(epToken) === true;

    function renderNonDbEndpointCell() {
      if (isResolvable && onOpenToken) {
        return (
          <a
            href="#"
            className="entity-link"
            onClick={e => { e.preventDefault(); onOpenToken(epToken); }}
          >
            {otherEp.name}
          </a>
        );
      }
      return <>{otherEp.name}</>;
    }

    return resolveIoRowCells(edge, otherEp).map((cell, i) => (
      <tr key={`${direction}-${otherEp.name}-${cell.text}-${i}`}>
        <td>{renderNonDbEndpointCell()}</td>
        <td><KindMarker ep={otherEp} processes={allProcesses} /></td>
        <td>{cell.text}</td>
        <td>{dirLabel}</td>
      </tr>
    ));
  }

  return (
    <div className="flow-table-wrap">
      <table className="dict-io-table">
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Kind</th>
            <th>Data</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {process.inputs.map(e => renderRow(e, 'in'))}
          {process.outputs.map(e => renderRow(e, 'out'))}
        </tbody>
      </table>
    </div>
  );
}
