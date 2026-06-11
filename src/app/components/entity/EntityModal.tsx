import { useEffect, useRef } from 'react';
import { RULES } from '../../../model/validate';
import type { EntityError } from '../../../model/validate';
import type { Model, ModelNode } from '../../../model/parse';
import type { ProcessUsage } from '../../../flows/flow-usage-index';
import { hexToRgba } from '../../logic/color';
import { upgradeMissingLinksInContainer } from '../../dom/body-links';
import { Modal } from '../ui/Modal';
import { ColumnsTable } from './ColumnsTable';
import { ChildrenTable } from './ChildrenTable';
import { ExamplesAccordion } from './ExamplesAccordion';
import { ProcessesSection } from '../process/ProcessesSection';

export function EntityModal({ selected, model, nodeById, nodeIdSet, entityErrors, onClose, onNavigate, processUsages, onNavigateToProcess, allFlowNodeIds }: {
  selected: ModelNode;
  model: Model | null;
  /** O(1) node lookup map — from modelIndex.nodeById. */
  nodeById?: Map<string, ModelNode>;
  /** O(1) node id membership set — from modelIndex.nodeIdSet. */
  nodeIdSet?: Set<string>;
  entityErrors: EntityError[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  processUsages?: ProcessUsage[];
  onNavigateToProcess?: (processId: string) => void;
  /** When set (flow-opened modal), run upgradeMissingLinksInContainer on the body
   *  so ext:/proc: references render as live `.entity-link` links, not missing spans. */
  allFlowNodeIds?: ReadonlySet<string>;
}) {
  const groups = model?.groups ?? {};
  const edges = model?.edges ?? [];
  const groupCfg = selected.group ? groups[selected.group] : undefined;
  // entityErrors is already scoped to this entity (pre-reduced by the caller via
  // appErrorsByEntityId.get(selected.id) ?? []) — no id-filter needed here.
  const errorsForSelected = entityErrors;

  // Upgrade pass for flow-opened modals: resolve missing-span links that were
  // rendered with entity-only knownIds but whose targets exist as flow nodes.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current && allFlowNodeIds) {
      upgradeMissingLinksInContainer(bodyRef.current, allFlowNodeIds);
    }
  }, [selected.bodyHtml, allFlowNodeIds]);

  const badges = (
    <div className="modal-badges">
      <span className={`badge ${selected.classification.toLowerCase()}`}>
        {selected.classification}
      </span>
      {groupCfg && (
        <span
          className="badge"
          style={{
            background: hexToRgba(groupCfg.color, 0.2),
            color: groupCfg.color,
          }}
        >
          {groupCfg.label}
        </span>
      )}
      <span className="pk-label">
        PK: {selected.pk.join(', ')}
      </span>
    </div>
  );

  return (
    <Modal title={selected.id.replace(/_/g, ' ')} onClose={onClose} headerExtra={badges}>
      <ColumnsTable
        node={selected}
        edges={edges}
        onNavigate={(id) => {
          const target = nodeById ? nodeById.get(id) : model?.nodes.find(n => n.id === id);
          if (target) onNavigate(id);
        }}
      />
      <div
        ref={bodyRef}
        className="doc-body"
        onClick={(e) => {
          // Body HTML is injected, so its `[[…]]` anchors can't carry React
          // handlers — delegate: intercept clicks on entity links and route
          // them through the same navigation the FK links use.
          const el = e.target;
          if (!(el instanceof Element)) return;
          const link = el.closest('a[data-entity]');
          if (!link) return;
          e.preventDefault();
          const id = link.getAttribute('data-entity');
          // In flow context (allFlowNodeIds present), allow any flow node id;
          // in graph context, limit to ERD entity nodes only.
          const hasNode = nodeIdSet
            ? (id !== null && id !== undefined && nodeIdSet.has(id))
            : (id !== null && id !== undefined && (model?.nodes.some(n => n.id === id) ?? false));
          const allowed = allFlowNodeIds
            ? (id && (allFlowNodeIds.has(id) || hasNode))
            : (id && hasNode);
          if (allowed && id) onNavigate(id);
        }}
        dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
      />
      <ChildrenTable
        node={selected}
        edges={edges}
        onNavigate={(id) => {
          const target = nodeById ? nodeById.get(id) : model?.nodes.find(n => n.id === id);
          if (target) onNavigate(id);
        }}
      />
      {errorsForSelected.length > 0 && (
        <div className="graph-modal-issues-section">
          <h4>Issues</h4>
          <ul>
            {errorsForSelected.map(err => (
              <li key={err.ruleId}>
                <strong>{RULES[err.ruleId]?.title ?? err.ruleId}</strong>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ExamplesAccordion node={selected} />
      {processUsages && processUsages.length > 0 && onNavigateToProcess && (
        <ProcessesSection usages={processUsages} onNavigateToProcess={onNavigateToProcess} />
      )}
    </Modal>
  );
}
