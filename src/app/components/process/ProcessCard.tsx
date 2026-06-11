import type { FlowProcess } from '../../../flows/flow-parse';
import type { FlowError } from '../../../flows/flow-validate';
import { RULES } from '../../../model/validate';
import { resolveBodyClick } from '../../dom/body-links';
import { IoTable } from './IoTable';
import { ProcessExamples } from './ProcessExamples';

export function ProcessCard({
  process,
  allProcesses,
  procErrors,
  onScrollToEntity,
  onScrollToSection,
  externalIds,
  nonDbStoreNames,
}: {
  process: FlowProcess;
  allProcesses: FlowProcess[];
  /** Pre-filtered errors for this process (replaces flowErrors array + per-process filter). */
  procErrors: FlowError[];
  onScrollToEntity: (entityId: string) => void;
  onScrollToSection: (id: string) => void;
  /** O(1) set of known external ids — used to decide whether a non-db endpoint is linkable. */
  externalIds: Record<string, true>;
  /** O(1) set of known non-db store names — same purpose. */
  nonDbStoreNames: Record<string, true>;
}) {

  // Non-db endpoint handlers for the DD card. The token is `kind:name` (e.g. `ext:Customer`).
  // We split at the first colon to get the name, then check whether the DD has a section for it.
  // canOpenToken is data-driven (O(1) hash lookup) — not document.getElementById — so it is safe
  // to call during render before the section has mounted.
  function canOpenToken(token: string): boolean {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) return false;
    const name = token.slice(colonIdx + 1);
    return externalIds[name] === true || nonDbStoreNames[name] === true;
  }

  function onOpenToken(token: string): void {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) return;
    const name = token.slice(colonIdx + 1);
    onScrollToSection(name);
  }

  return (
    <section className="dict-entity-section" id={`process-${process.id}`}>
      <div className="dict-entity-header">
        <span className="flow-dotted-number">{process.dottedNumber}</span>
        <h2 className="flow-process-label">{process.label}</h2>
      </div>

      {procErrors.length > 0 && (
        <details className="dict-entity-warning">
          <summary>⚠ {procErrors.length} issue{procErrors.length > 1 ? 's' : ''}</summary>
          <ul className="dict-entity-warning-detail">
            {procErrors.map((err, i) => {
              const rule = RULES[err.ruleId];
              const title = rule ? rule.title : err.ruleId;
              return <li key={i}><strong>{title}</strong> — {err.message}</li>;
            })}
          </ul>
        </details>
      )}

      <IoTable
        process={process}
        allProcesses={allProcesses}
        onScrollToEntity={onScrollToEntity}
        onOpenToken={onOpenToken}
        canOpenToken={canOpenToken}
      />

      {process.bodyHtml && (
        <div
          className="flow-node-body flow-node-body--process"
          dangerouslySetInnerHTML={{ __html: process.bodyHtml }}
          onClick={e => resolveBodyClick(e, onScrollToSection)}
        />
      )}

      <ProcessExamples examples={process.examples} />
    </section>
  );
}
