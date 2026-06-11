import type { ModelNode, ModelEdge } from '../../../model/parse';

/**
 * Unified relationships table for the entity modal and the data dictionary card.
 *
 * variant="modal" (default) — wraps in .doc-section with "Relationships" h2 +
 *   .table-scroll; uses a plain <table>; link is .fk-link with onClick only;
 *   predicate shows fwd + inline .predicate-rev span when different;
 *   cardinality uses "parent:child" colon separator.
 *
 * variant="dict" — wraps in fragment with dict-rel-heading h4 + .dict-table-wrap;
 *   uses .dict-rel-table; link has href + onClick; predicate uses pill layout
 *   (.dict-predicate-cell / .dict-predicate-pill--shared|primary|inverse);
 *   cardinality uses "parent → child" arrow separator.
 */
export function ChildrenTable({
  node,
  edges,
  onNavigate,
  variant = 'modal',
}: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
  variant?: 'modal' | 'dict';
}) {
  const children = edges.filter(e => e.target === node.id);
  if (children.length === 0) return null;

  if (variant === 'dict') {
    return (
      <>
        <h4 className="dict-rel-heading">Downstream relationships</h4>
        <div className="dict-table-wrap">
          <table className="dict-rel-table">
            <thead>
              <tr>
                <th>Child entity</th>
                <th>Type</th>
                <th>Predicate</th>
                <th>Cardinality</th>
              </tr>
            </thead>
            <tbody>
              {children.map(e => (
                <tr key={e.source}>
                  <td>
                    <a
                      href={`#entity-${e.source}`}
                      onClick={ev => { ev.preventDefault(); onNavigate(e.source); }}
                    >
                      {e.source}
                    </a>
                  </td>
                  <td>{e.identifying ? 'Identifying' : 'Referential'}</td>
                  <td>
                    {e.predicate.fwd === e.predicate.rev ? (
                      <div className="dict-predicate-cell">
                        <span className="dict-predicate-pill dict-predicate-pill--shared">{e.predicate.fwd}</span>
                      </div>
                    ) : (
                      <div className="dict-predicate-cell">
                        <span className="dict-predicate-pill dict-predicate-pill--primary">
                          {e.predicate.rev}<span className="dict-predicate-arrow"> →</span>
                        </span>
                        <span className="dict-predicate-pill dict-predicate-pill--inverse">
                          <span className="dict-predicate-arrow">← </span>{e.predicate.fwd}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>{e.cardinality.parent} → {e.cardinality.child}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // variant === 'modal'
  return (
    <div className="doc-section">
      <h2>Relationships</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Child</th>
              <th>Type</th>
              <th>Predicate</th>
              <th>Cardinality</th>
            </tr>
          </thead>
          <tbody>
            {children.map(edge => (
              <tr key={edge.source}>
                <td>
                  <a className="fk-link" onClick={() => onNavigate(edge.source)}>
                    {edge.source}
                  </a>
                </td>
                <td>{edge.identifying ? 'Identifying' : 'Referential'}</td>
                <td>{edge.predicate.fwd}{edge.predicate.rev !== edge.predicate.fwd && <span className="predicate-rev">{edge.predicate.rev}</span>}</td>
                <td>{edge.cardinality.parent}:{edge.cardinality.child}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
