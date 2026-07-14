import type { FlowSearchResult, FlowSearchResultKind } from '../../logic/search';

// Single-letter badge, same visual idiom as .flow-kind-marker (KindMarker.tsx)
// but keyed on FlowSearchResultKind — a different taxonomy (process/external/
// store/diagram result rows, not FlowEndpoint kinds like db/cache/queue).
const RESULT_KIND_LABEL: Record<FlowSearchResultKind, string> = {
  process: 'P',
  external: 'E',
  store: 'S',
  diagram: 'D',
};

// Display cap (SC6) — the dropdown lists at most this many rows, with a
// "+N more" line for the remainder. Broad terms on large models can otherwise
// produce results too long to be scannable.
const DISPLAY_CAP = 20;

/**
 * Flow search results dropdown (graph-flow-search CP3), rendered into the
 * flow SearchBar's results slot. Rows arrive already grouped by diagram —
 * searchFlowDiagrams walks one diagram fully (parent, then its sub-DFDs)
 * before moving to the next — so same-diagram rows are always contiguous.
 */
export function FlowSearchResults({ results, onSelect }: {
  results: FlowSearchResult[];
  onSelect: (diagramId: string) => void;
}) {
  if (results.length === 0) return null;

  const shown = results.slice(0, DISPLAY_CAP);
  const overflow = results.length - shown.length;

  const groups: Array<{ diagramId: string; diagramTitle: string; rows: FlowSearchResult[] }> = [];
  for (const row of shown) {
    const last = groups[groups.length - 1];
    if (last && last.diagramId === row.diagramId) {
      last.rows.push(row);
    } else {
      groups.push({ diagramId: row.diagramId, diagramTitle: row.diagramTitle, rows: [row] });
    }
  }

  return (
    <div className="viewer-search-results">
      {groups.map(group => (
        <div key={group.diagramId} className="viewer-search-results-group">
          <div className="viewer-search-results-group-title">{group.diagramTitle}</div>
          {group.rows.map(row => (
            <button
              key={row.token}
              type="button"
              className="viewer-search-result-row"
              data-token={row.token}
              data-diagram-id={row.diagramId}
              onClick={() => onSelect(row.diagramId)}
            >
              <span className="viewer-search-result-kind">
                {RESULT_KIND_LABEL[row.kind]}
              </span>
              {row.dottedNumber && (
                <span className="viewer-search-result-dotted">{row.dottedNumber}</span>
              )}
              <span className="viewer-search-result-label">{row.label}</span>
            </button>
          ))}
        </div>
      ))}
      {overflow > 0 && (
        <div className="viewer-search-results-overflow">+{overflow} more</div>
      )}
    </div>
  );
}
