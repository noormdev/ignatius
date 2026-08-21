import { useMemo, useState } from 'react';
import { describeJson, formatJsonFull, formatJsonPreview } from '../../logic/json-value';
import { highlightJson } from '../../logic/json-highlight';
import { Modal } from './Modal';

/**
 * A structured value inside a table cell: monospaced one-line preview plus an
 * expander that opens the pretty-printed document in its own dialog.
 *
 * The dialog is always `stacked`, which covers both callers without either of
 * them having to know where it sits — from the dictionary page it is the only
 * modal on screen, and from an entity or process dialog it layers over the
 * opener. It renders inline rather than through a portal so that a click on its
 * backdrop is caught by the opener's stop-propagation handler.
 */
export function JsonValue({ value, label }: { value: object; label: string }) {
  const [expanded, setExpanded] = useState(false);

  // Only pay for highlighting once the dialog is actually open — a dictionary
  // page can carry hundreds of these cells, none of them expanded.
  const highlighted = useMemo(
    () => (expanded ? highlightJson(formatJsonFull(value)) : ''),
    [expanded, value],
  );

  return (
    <span className="json-value">
      <code className="json-value-preview">{formatJsonPreview(value)}</code>
      <button
        type="button"
        className="json-value-expand"
        aria-label={`Expand ${label}`}
        title={`Expand ${label}`}
        onClick={() => setExpanded(true)}
      >
        ⤢
      </button>
      {expanded && (
        <Modal
          title={label}
          onClose={() => setExpanded(false)}
          className="modal-json"
          stacked
          headerExtra={<span className="json-value-shape">{describeJson(value)}</span>}
        >
          <div
            className="json-value-full"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </Modal>
      )}
    </span>
  );
}
