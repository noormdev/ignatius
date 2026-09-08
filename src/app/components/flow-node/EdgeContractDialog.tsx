import type { FlowEdge } from '../../../flows/flow-parse';
import type { Model } from '../../../model/parse';
import { normalizeEdgeData } from '../../../flow-view/flow-layout';
import { hexToRgba } from '../../logic/color';
import { Modal } from '../ui/Modal';

/** One row of the CONTRACT table: a store's column, its entity type, and its
 *  group badge (absent for a store with no `group:`). */
type ContractRow = {
  key: string;
  group?: { label: string; color: string };
  storeId: string;
  column: string;
  type: string;
};

/**
 * Contract dialog for a data-carrying flow edge — one edge for a plain `db:`
 * store, one per member for a stack edge. A `db:` edge resolves its columns
 * against the entity model for a group/store/column/type table, sorted by
 * store then by the entity's own column order; every other endpoint kind
 * (ext:, cache:, queue:, ...) has no entity-model backing and is never
 * stacked, so its dialog falls back to a one-column table of the authored
 * data lines.
 */
export function EdgeContractDialog({ edges, sourceLabel, targetLabel, entityModel, onClose, onOpenEntity }: {
  edges: FlowEdge[];
  /** Source/target node labels — the same text the hover tooltip header shows,
   *  naming a stack the way its own dialog does (its label, or "Read
   *  stack"/"Write stack" for a per-process stack). */
  sourceLabel: string;
  targetLabel: string;
  entityModel?: Model;
  onClose: () => void;
  /** Opens the store's entity dialog for a `db:` token, closing this dialog
   *  first — reuses FlowSurface's existing dialog-close-before-entity-open rule. */
  onOpenEntity: (token: string) => void;
}) {
  if (edges.length === 0) return null;

  const storeEndpointOf = (edge: FlowEdge) => (edge.from.kind === 'proc' ? edge.to : edge.from);
  const first = edges[0]!;
  const firstStore = storeEndpointOf(first);
  // A read has the store as the edge's `from` (store → process); a write has
  // it as `to`. sourceLabel/targetLabel already name each side the way the
  // canvas does, so reuse whichever one is the store side as the title
  // fallback — never the raw endpoint slug, and never a bare "Contract".
  const storeSideLabel = first.from.kind !== 'proc' ? sourceLabel : targetLabel;
  const commonLabel = edges.every(e => e.label === first.label) ? first.label : undefined;
  const title = commonLabel ?? storeSideLabel;
  const route = (
    <div className="modal-badges">
      <span className="pk-label">{sourceLabel} → {targetLabel}</span>
    </div>
  );

  if (firstStore.kind !== 'db') {
    const dataLines = edges.flatMap(e => normalizeEdgeData(e.data));
    return (
      <Modal title={title} onClose={onClose} headerExtra={route}>
        <div className="doc-section">
          <h2>Data</h2>
          <div className="flow-table-wrap">
            <table className="dict-io-table">
              <thead>
                <tr><th>Item</th></tr>
              </thead>
              <tbody>
                {dataLines.map((line, i) => (
                  <tr key={`${line}-${i}`}><td>{line}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  }

  const rows: ContractRow[] = [];
  for (const edge of edges) {
    const storeEndpoint = storeEndpointOf(edge);
    const entity = entityModel?.nodes.find(n => n.id === storeEndpoint.name);
    const groupCfg = entity?.group ? entityModel?.groups[entity.group] : undefined;
    const columnOrder = entity ? Object.keys(entity.columns) : [];
    const columns = normalizeEdgeData(edge.data)
      .slice()
      .sort((a, b) => columnOrder.indexOf(a) - columnOrder.indexOf(b));
    for (const column of columns) {
      rows.push({
        key: `${storeEndpoint.name}-${column}`,
        group: groupCfg ? { label: groupCfg.label, color: groupCfg.color } : undefined,
        storeId: storeEndpoint.name,
        column,
        type: entity?.columns[column]?.type ?? '—',
      });
    }
  }
  rows.sort((a, b) => a.storeId.localeCompare(b.storeId));

  return (
    <Modal title={title} onClose={onClose} headerExtra={route}>
      <div className="doc-section">
        <h2>Contract</h2>
        <div className="flow-table-wrap">
          <table className="dict-io-table">
            <thead>
              <tr><th>Group</th><th>Store</th><th>Column</th><th>Type</th></tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.key}-${i}`}>
                  <td>
                    {row.group && (
                      <span
                        className="badge"
                        style={{ background: hexToRgba(row.group.color, 0.2), color: row.group.color }}
                      >
                        {row.group.label}
                      </span>
                    )}
                  </td>
                  <td>
                    <a
                      href={`#entity-${row.storeId}`}
                      className="entity-link"
                      data-entity={row.storeId}
                      onClick={e => { e.preventDefault(); onOpenEntity(`db:${row.storeId}`); }}
                    >
                      {row.storeId.replace(/_/g, ' ')}
                    </a>
                  </td>
                  <td><code>{row.column}</code></td>
                  <td>{row.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
