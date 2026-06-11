import { RULES } from '../../../model/validate';
import type { EntityError } from '../../../model/validate';
import type { ModelNode, ModelEdge, SubtypeCluster } from '../../../model/parse';
import type { ProcessUsage } from '../../../flows/flow-usage-index';
import { ClassificationBadge } from './ClassificationBadge';
import { ColumnsTable } from './ColumnsTable';
import { ChildrenTable } from './ChildrenTable';
import { ExamplesAccordion } from './ExamplesAccordion';
import { ProcessesTable } from '../process/ProcessesTable';

export function EntityCard({
  node,
  edges,
  basetypeCluster,
  memberCluster,
  nodeErrors,
  missingTargets,
  onNavigate,
  onNavigateMissing,
  processUsages,
  onScrollToProcess,
}: {
  node: ModelNode;
  edges: ModelEdge[];
  /** Pre-looked-up cluster where node.id is the basetype (undefined if none). */
  basetypeCluster: SubtypeCluster | undefined;
  /** Pre-looked-up cluster where node.id is a member (undefined if none). */
  memberCluster: SubtypeCluster | undefined;
  /** Pre-filtered errors for this node. */
  nodeErrors: EntityError[];
  missingTargets: Set<string>;
  onNavigate: (entityId: string) => void;
  onNavigateMissing: (id: string) => void;
  processUsages?: ProcessUsage[];
  onScrollToProcess?: (processId: string) => void;
}) {
  const pkList = node.pk.join(', ');
  const pkLabel = node.pk.length > 0 ? <span className="dict-pk-label">PK: <code>{pkList}</code></span> : null;

  const isBasetypeOf = basetypeCluster;
  const isSubtypeOf = memberCluster;

  return (
    <section className="dict-entity-section" id={`entity-${node.id}`}>
      <div className="dict-entity-header">
        <h2>{node.id}</h2>
        <ClassificationBadge cls={node.classification} />
        {isBasetypeOf && (
          <span
            className="dict-badge"
            style={{ background: 'var(--badge-classifier-bg)', color: 'var(--badge-classifier-fg)' }}
          >
            basetype · {isBasetypeOf.exclusive ? 'exclusive' : 'inclusive'}
          </span>
        )}
        {isSubtypeOf && (
          <span
            className="dict-badge"
            style={{ background: 'var(--badge-classifier-bg)', color: 'var(--badge-classifier-fg)' }}
          >
            of{' '}
            <a
              href={`#entity-${isSubtypeOf.basetype}`}
              onClick={e => { e.preventDefault(); onNavigate(isSubtypeOf.basetype); }}
            >
              {isSubtypeOf.basetype}
            </a>
          </span>
        )}
        {pkLabel}
      </div>

      {nodeErrors.length > 0 && (
        <details className="dict-entity-warning">
          <summary>⚠ {nodeErrors.length} issue{nodeErrors.length > 1 ? 's' : ''}</summary>
          <ul className="dict-entity-warning-detail">
            {nodeErrors.map((err, i) => {
              const rule = RULES[err.ruleId];
              const title = rule ? rule.title : err.ruleId;
              return (
                <li key={i}><strong>{title}</strong> — {err.message}</li>
              );
            })}
          </ul>
        </details>
      )}

      {isBasetypeOf && (
        <p className="dict-subtype-list">
          Subtypes:{' '}
          {isBasetypeOf.members.map((m, i) => (
            <span key={m}>
              {i > 0 ? ', ' : ''}
              <a href={`#entity-${m}`} onClick={e => { e.preventDefault(); onNavigate(m); }}>{m}</a>
            </span>
          ))}
        </p>
      )}

      <ColumnsTable variant="dict" node={node} edges={edges} missingTargets={missingTargets} onNavigate={onNavigate} onNavigateMissing={onNavigateMissing} />
      <ChildrenTable variant="dict" node={node} edges={edges} onNavigate={onNavigate} />

      {node.bodyHtml && (
        <div
          className="dict-entity-body"
          dangerouslySetInnerHTML={{ __html: node.bodyHtml }}
          onClick={e => {
            const t = e.target;
            if (!(t instanceof Element)) return;
            // Live anchor: <a data-entity="X">
            const link = t.closest('a[data-entity]');
            if (link) {
              e.preventDefault();
              const entityId = link.getAttribute('data-entity');
              if (entityId) onNavigate(entityId);
              return;
            }
            // Missing span: <span class="entity-link--missing" title="Unknown entity: X">
            // Resolved at click time — timing-independent, survives React reconciliation.
            const span = t.closest('span.entity-link--missing');
            if (span) {
              const title = span.getAttribute('title') ?? '';
              const prefix = 'Unknown entity: ';
              if (title.startsWith(prefix)) {
                const target = title.slice(prefix.length);
                onNavigate(target);
              }
            }
          }}
        />
      )}

      <ExamplesAccordion node={node} variant="dict" />
      {processUsages && processUsages.length > 0 && onScrollToProcess && (
        <ProcessesTable usages={processUsages} onScrollToProcess={onScrollToProcess} />
      )}
    </section>
  );
}
