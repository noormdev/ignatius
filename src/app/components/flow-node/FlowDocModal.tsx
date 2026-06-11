import type { FlowDoc } from '../../logic/doc-resolver';
import { Modal } from '../ui/Modal';

/** Plain markdown documentation dialog. Used for the empty-state fallback
 *  (absent-entity db: token) and wiki-links that resolve to no structured node. */
export function FlowDocModal({ doc, onClose, onNavigate }: {
  doc: FlowDoc;
  onClose: () => void;
  onNavigate: (token: string) => void;
}) {
  return (
    <Modal title={doc.title.replace(/_/g, ' ')} onClose={onClose}>
      <div
        className="doc-body"
        onClick={e => {
          // Injected HTML can't carry React handlers — delegate clicks on
          // `[[…]]` anchors through the same navigation path.
          const el = e.target;
          if (!(el instanceof Element)) return;
          const link = el.closest('a[data-entity]');
          if (!link) return;
          e.preventDefault();
          const id = link.getAttribute('data-entity');
          if (id) onNavigate(id);
        }}
        dangerouslySetInnerHTML={{ __html: doc.bodyHtml }}
      />
    </Modal>
  );
}
