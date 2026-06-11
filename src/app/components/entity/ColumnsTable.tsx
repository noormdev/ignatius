import type { ReactNode } from 'react';
import type { ModelNode, ModelEdge } from '../../../model/parse';

/**
 * Unified columns table for the entity modal and the data dictionary card.
 *
 * variant="modal" (default) — wraps in .doc-section with "Attributes" heading +
 *   .table-scroll; uses a plain <table>; header says "Null"; FK cells show
 *   "FK → <target>" using .fk-link; no missingTargets handling.
 *
 * variant="dict" — wraps in .dict-table-wrap; uses .dict-attr-table; header says
 *   "Nullable"; type cell is <code>; FK cells show target link only (no "FK → "
 *   prefix) with ` · ` separators; supports missingTargets + onNavigateMissing.
 */
export function ColumnsTable({
  node,
  edges,
  onNavigate,
  variant = 'modal',
  missingTargets,
  onNavigateMissing,
}: {
  node: ModelNode;
  edges: ModelEdge[];
  onNavigate: (entityId: string) => void;
  variant?: 'modal' | 'dict';
  /** dict variant only — entities whose graph nodes are missing (broken-demo). */
  missingTargets?: Set<string>;
  /** dict variant only — called when clicking a missing FK target. */
  onNavigateMissing?: (id: string) => void;
}) {
  const fkTargets: Record<string, string> = {};
  for (const edge of edges) {
    if (edge.source === node.id) {
      for (const childCol of Object.keys(edge.on)) {
        fkTargets[childCol] = edge.target;
      }
    }
  }

  const cols = Object.entries(node.columns);
  if (cols.length === 0) return null;

  if (variant === 'dict') {
    const pkSet: Record<string, true> = {};
    for (const k of node.pk) pkSet[k] = true;

    const akSet: Record<string, true> = {};
    for (const ak of node.alternateKeys ?? []) {
      if (!Array.isArray(ak?.columns)) continue;
      for (const col of ak.columns) akSet[col] = true;
    }

    return (
      <div className="dict-table-wrap">
        <table className="dict-attr-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Key</th>
              <th>Nullable</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {cols.map(([name, col]) => {
              const isPk = pkSet[name];
              const isFk = fkTargets[name];
              const isAk = akSet[name];
              const parts: ReactNode[] = [];
              if (isPk) parts.push('PK');
              if (isFk) {
                const target = fkTargets[name] ?? '';
                parts.push(
                  missingTargets?.has(target)
                    ? <a key="fk" className="dict-link-missing" href={`#missing-${target}`} onClick={e => { e.preventDefault(); onNavigateMissing?.(target); }}>{target}</a>
                    : <a key="fk" href={`#entity-${target}`} onClick={e => { e.preventDefault(); onNavigate(target); }}>{target}</a>
                );
              }
              if (isAk) parts.push('AK');
              return (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td><code>{col.type}</code></td>
                  <td>
                    {parts.length === 0 ? '—' : parts.map((p, i) => (
                      <span key={i}>{i > 0 ? ' · ' : ''}{p}</span>
                    ))}
                  </td>
                  <td>{col.nullable ? 'Yes' : 'No'}</td>
                  <td>{col.default != null ? String(col.default) : ''}</td>
                  <td>{col.desc ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // variant === 'modal'
  function renderRoles(name: string) {
    const parts: (string | ReactNode)[] = [];
    if (node.pk.includes(name)) parts.push('PK');
    if (fkTargets[name]) {
      const target = fkTargets[name];
      parts.push(
        <span key="fk">
          FK →{' '}
          <a className="fk-link" onClick={() => onNavigate(target)}>
            {target}
          </a>
        </span>
      );
    }
    for (const ak of node.alternateKeys) {
      if (ak.columns.includes(name)) parts.push('AK');
    }
    if (parts.length === 0) return '—';
    return parts.map((p, i) => (
      <span key={i}>{i > 0 ? ', ' : ''}{p}</span>
    ));
  }

  return (
    <div className="doc-section">
      <h2>Attributes</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Type</th>
              <th>Key</th>
              <th>Null</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {cols.map(([name, col]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{col.type}</td>
                <td>{renderRoles(name)}</td>
                <td>{col.nullable ? 'Yes' : 'No'}</td>
                <td>{col.default ?? ''}</td>
                <td>{col.desc ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
