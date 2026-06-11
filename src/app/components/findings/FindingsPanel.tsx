import { RULES } from '../../../model/validate';
import type { EntityError, GlobalError } from '../../../model/validate';
import type { FlowError } from '../../../flows/flow-validate';
import { buildFindingRows } from '../../logic/finding-rows';
import type { FindingRow } from '../../logic/finding-rows';

// FindingsPanel — persistent top-right panel listing all current findings.
//
// Renders when totalFindings > 0; hidden when zero (no empty chrome).
// Each row is a <details> accordion; opening an entity-scoped row fires
// onNavigate so the graph viewport pans + zooms + selects that entity.
// Global-scoped rows expand inline only (no entity to navigate to).

export function FindingsPanel({
  globalErrors,
  entityErrors,
  flowErrors,
  collapsed,
  onCollapse,
  onExpand,
  onNavigate,
}: {
  globalErrors: GlobalError[];
  entityErrors: EntityError[];
  flowErrors?: FlowError[];
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onNavigate: (entityId: string) => void;
}) {
  const rows = buildFindingRows(globalErrors, entityErrors, flowErrors);
  const total = rows.length;

  if (total === 0) return null;

  if (collapsed) {
    return (
      <aside className="findings-panel findings-panel--collapsed">
        <button className="findings-panel-badge" onClick={onExpand}>
          ⚠ {total} {total === 1 ? 'issue' : 'issues'}
        </button>
      </aside>
    );
  }

  return (
    <aside className="findings-panel">
      <header className="findings-panel-header">
        <h3>Issues ({total})</h3>
        <button className="findings-panel-collapse" onClick={onCollapse} aria-label="Collapse panel">
          −
        </button>
      </header>
      <ul className="findings-panel-list">
        {rows.map((row, i) => {
          const rule = RULES[row.ruleId];
          const location = row.kind === 'entity' ? row.entityId : row.location;
          const detail = row.kind === 'entity' || row.kind === 'flow' ? row.message : row.reason;

          return (
            <li key={i}>
              <details
                onToggle={(e) => {
                  // Only navigate on open (not on close), and only for entity rows.
                  if ((e.target as HTMLDetailsElement).open && row.kind === 'entity') {
                    onNavigate(row.entityId);
                  }
                }}
              >
                <summary className="finding-summary">
                  <span className={`finding-severity finding-severity--${row.severity}`}>
                    {row.severity === 'error' ? 'ERR' : 'WARN'}
                  </span>
                  <span className="finding-rule">{row.ruleId}</span>
                  <span className="finding-location">{location}</span>
                </summary>
                <div className="finding-detail">
                  {rule && (
                    <>
                      <strong className="finding-detail-title">{rule.title}</strong>
                      <p className="finding-detail-explanation">{rule.explanation}</p>
                    </>
                  )}
                  <p className="finding-detail-message">{detail}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
