import type { ReactNode } from 'react';
import type { FlowStoreRef } from '../../../flows/flow-parse';

/**
 * Renders the header (kind badge + name) for a non-db flow store.
 * Body is NOT rendered here — callers that want body pass it as children.
 * db: stores are excluded (they open the rich entity dialog instead).
 */
export function StoreCard({
  store,
  children,
}: {
  store: FlowStoreRef;
  children?: ReactNode;
}) {
  if (store.kind === 'db') return null;
  return (
    <section className="dict-entity-section" id={`store-${store.name}`}>
      <div className="dict-entity-header">
        <span className="flow-store-kind">{store.kind.toUpperCase()}</span>
        <h3 className="flow-store-name">{store.displayName}</h3>
      </div>
      {children}
    </section>
  );
}
