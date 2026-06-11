import { useEffect, useRef } from 'react';
import type { FlowProcess, FlowExternal, FlowStoreRef } from '../../../flows/flow-parse';
import type { ProcessUsage } from '../../../flows/flow-usage-index';
import type { FlowDoc } from '../../logic/doc-resolver';
import { upgradeMissingLinksInContainer } from '../../dom/body-links';
import { Modal } from '../ui/Modal';
import { IoTable } from '../process/IoTable';
import { ProcessExamples } from '../process/ProcessExamples';
import { ProcessesSection } from '../process/ProcessesSection';
import { ExternalCard } from './ExternalCard';
import { StoreCard } from './StoreCard';

/**
 * Facts-rich dialog for a non-entity flow node (process / external / non-db store).
 * Renders the node's structured data above its markdown body.
 * Reuses the Dictionary's FlowIoTable / DictExternalSection / DictStoreSection
 * components so the dialog and the dictionary show the same structured facts.
 */
export function FlowNodeModal({ node, allProcesses, doc, onClose, onNavigate, allFlowNodeIds, canOpenToken, nodeUsageIndex }: {
  node: FlowProcess | FlowExternal | FlowStoreRef;
  allProcesses: FlowProcess[];
  doc: FlowDoc;
  onClose: () => void;
  onNavigate: (token: string) => void;
  allFlowNodeIds?: ReadonlySet<string>;
  /** When provided, non-db IO table endpoints whose token resolves become clickable links. */
  canOpenToken?: (token: string) => boolean;
  /** Token-keyed usage index (buildFlowNodeUsageIndex). When provided, ext/store
   *  branches render the Processes cross-reference table (CP21). */
  nodeUsageIndex?: ReadonlyMap<string, ProcessUsage[]>;
}) {
  // Upgrade pass: resolve `.entity-link--missing` spans inside the body to live
  // anchors when the target exists in the full flow + entity node-id set.
  // Body HTML is rendered at parse time with entity-only knownIds, so ext:/proc:
  // references start as missing. This pass corrects them after the modal mounts.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current && allFlowNodeIds) {
      upgradeMissingLinksInContainer(bodyRef.current, allFlowNodeIds);
    }
  }, [doc.bodyHtml, allFlowNodeIds]);

  function handleBodyClick(e: React.MouseEvent) {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const link = el.closest('a[data-entity]');
    if (!link) return;
    e.preventDefault();
    const id = link.getAttribute('data-entity');
    if (id) onNavigate(id);
  }

  // FlowProcess has `inputs` + `outputs`; FlowStoreRef has `displayName`; FlowExternal has neither.
  // TypeScript narrows on these property presence guards — no casts needed.
  // Note: FlowExternal now also carries optional `kind`, so we cannot use 'kind' in node
  // to distinguish FlowStoreRef — use `displayName` which is required on FlowStoreRef only.
  function renderFacts() {
    if ('inputs' in node) {
      // FlowProcess
      return (
        <div className="flow-node-dialog-facts">
          <IoTable
            process={node}
            allProcesses={allProcesses}
            onScrollToEntity={() => { /* no-op: dialog context */ }}
            onOpenEntity={onNavigate}
            onOpenToken={onNavigate}
            canOpenToken={canOpenToken}
          />
        </div>
      );
    }
    if ('displayName' in node) {
      // FlowStoreRef — token is "kind:name" (e.g. "file:gateway-log")
      const storeToken = `${node.kind}:${node.name}`;
      const storeUsages = nodeUsageIndex?.get(storeToken);
      return (
        <div className="flow-node-dialog-facts">
          <StoreCard store={node} />
          {storeUsages && storeUsages.length > 0 && (
            <ProcessesSection
              usages={storeUsages}
              onNavigateToProcess={(processId) => onNavigate(`proc:${processId}`)}
            />
          )}
        </div>
      );
    }
    // FlowExternal — token is "ext:<id>"
    const extToken = `ext:${node.id}`;
    const extUsages = nodeUsageIndex?.get(extToken);
    return (
      <div className="flow-node-dialog-facts">
        <ExternalCard external={node} />
        {extUsages && extUsages.length > 0 && (
          <ProcessesSection
            usages={extUsages}
            onNavigateToProcess={(processId) => onNavigate(`proc:${processId}`)}
          />
        )}
      </div>
    );
  }

  return (
    <Modal title={doc.title.replace(/_/g, ' ')} onClose={onClose}>
      {renderFacts()}
      {doc.bodyHtml && (
        <div
          ref={bodyRef}
          className="doc-body"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
        />
      )}
      {'inputs' in node && <ProcessExamples examples={node.examples} />}
    </Modal>
  );
}
