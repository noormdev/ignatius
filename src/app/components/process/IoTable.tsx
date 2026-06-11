import type { FlowProcess, FlowEdge, FlowEndpoint } from '../../../flows/flow-parse';
import { KindMarker } from './KindMarker';

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
      const dataColumns: string[] = Array.isArray(edge.data)
        ? edge.data
        : edge.data.length > 0 ? [edge.data] : [];

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

      if (dataColumns.length === 0) {
        return (
          <tr key={`${direction}-${entityId}-empty`}>
            <td>{renderEntityCell()}</td>
            <td><KindMarker ep={otherEp} processes={allProcesses} /></td>
            <td>—</td>
            <td>{dirLabel}</td>
          </tr>
        );
      }

      return dataColumns.map(col => (
        <tr key={`${direction}-${entityId}-${col}`}>
          <td>{renderEntityCell()}</td>
          <td><KindMarker ep={otherEp} processes={allProcesses} /></td>
          <td><code>{col}</code></td>
          <td>{dirLabel}</td>
        </tr>
      ));
    }

    // Non-db endpoint
    const dataLabel = Array.isArray(edge.data)
      ? edge.data.join(', ')
      : edge.data;

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

    return (
      <tr key={`${direction}-${otherEp.name}-${dataLabel}`}>
        <td>{renderNonDbEndpointCell()}</td>
        <td><KindMarker ep={otherEp} processes={allProcesses} /></td>
        <td>{dataLabel || '—'}</td>
        <td>{dirLabel}</td>
      </tr>
    );
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
