import type { ReactNode } from 'react';
import type { FlowExternal } from '../../../flows/flow-parse';

/**
 * Renders the header (EXT badge + label) for a flow external entity.
 * Body is NOT rendered here — callers that want body (the DD section) pass
 * it as children; the FlowNodeModal renders body separately after renderFacts().
 * This avoids the duplicate-body bug where the modal rendered body twice.
 */
export function ExternalCard({
  external,
  children,
}: {
  external: FlowExternal;
  children?: ReactNode;
}) {
  return (
    <section className="dict-entity-section" id={`external-${external.id}`}>
      <div className="dict-entity-header">
        <span className="flow-external-kind">EXT</span>
        <h3 className="flow-external-name">{external.label}</h3>
      </div>
      {children}
    </section>
  );
}
