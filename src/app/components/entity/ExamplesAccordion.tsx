import type { ModelNode } from '../../../model/parse';

export function ExamplesAccordion({ node, variant = 'modal' }: { node: ModelNode; variant?: 'modal' | 'dict' }) {
  const examples = node.examples;
  if (!examples || examples.length === 0) return null;

  const pkSet: Record<string, true> = {};
  for (const k of node.pk) pkSet[k] = true;
  const declaredCols = Object.keys(node.columns).filter(k => !pkSet[k]);
  const headers = [...node.pk, ...declaredCols];
  const isOpen = examples.length <= 3;

  if (variant === 'dict') {
    return (
      <details className="dict-examples" open={isOpen || undefined}>
        <summary>Examples ({examples.length} row{examples.length === 1 ? '' : 's'})</summary>
        <div className="dict-examples-table-wrap">
          <table className="dict-examples-table">
            <thead>
              <tr>{headers.map(h => <th key={h}><code>{h}</code></th>)}</tr>
            </thead>
            <tbody>
              {examples.map((row, i) => (
                <tr key={i}>
                  {headers.map(h => (
                    <td key={h}>
                      {row[h] !== undefined && row[h] !== null
                        ? String(row[h])
                        : <span className="dict-example-empty">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    );
  }

  return (
    <details className="modal-examples doc-section" open={isOpen || undefined}>
      <summary>Examples ({examples.length})</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {examples.map((row, i) => (
              <tr key={i}>
                {headers.map(h => (
                  <td key={h}>
                    {row[h] !== undefined && row[h] !== null && row[h] !== ''
                      ? String(row[h])
                      : <span className="example-empty">–</span>
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
