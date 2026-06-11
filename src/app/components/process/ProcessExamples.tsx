import type { FlowProcess, FlowExample } from '../../../flows/flow-parse';

/**
 * Renders the `examples: { in, out }` data from a FlowProcess as a series of
 * small tables — one per entry — after the process body in the dialog.
 * Mirrors ExamplesAccordion: columns = union of keys across that entry's rows;
 * blank cell (–) when a row lacks a key.
 * Returns null when the process has no examples (no empty section rendered).
 */
export function ProcessExamples({ examples }: { examples: FlowProcess['examples'] }) {
  if (!examples) return null;
  const allEntries: Array<{ direction: 'in' | 'out'; entry: FlowExample }> = [
    ...examples.in.map(e => ({ direction: 'in' as const, entry: e })),
    ...examples.out.map(e => ({ direction: 'out' as const, entry: e })),
  ];
  if (allEntries.length === 0) return null;

  return (
    <div className="flow-process-examples">
      {allEntries.map(({ direction, entry }, i) => {
        const counterpart = direction === 'in' ? (entry.from ?? '') : (entry.to ?? '');
        const caption = [
          direction,
          counterpart,
          entry.label,
        ].filter(Boolean).join(' · ');

        // Columns = union of keys across all rows, in insertion order
        const colSet = new Set<string>();
        for (const row of entry.rows) {
          for (const k of Object.keys(row)) colSet.add(k);
        }
        const cols = Array.from(colSet);

        if (cols.length === 0 && entry.rows.length === 0) return null;

        return (
          <details key={i} className="modal-examples doc-section" open={entry.rows.length <= 3 || undefined}>
            <summary>{caption} ({entry.rows.length} row{entry.rows.length === 1 ? '' : 's'})</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {entry.rows.map((row, ri) => (
                    <tr key={ri}>
                      {cols.map(c => (
                        <td key={c}>
                          {row[c] !== undefined && row[c] !== null && row[c] !== ''
                            ? String(row[c])
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
      })}
    </div>
  );
}
