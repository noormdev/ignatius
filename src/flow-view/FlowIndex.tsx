/**
 * FlowIndex.tsx — the flow index: every diagram and process as an SSADM
 * process-hierarchy chart, with a side pane describing the row under the
 * pointer, else the focused row, else the current diagram, else the model.
 * Clicking a row opens its diagram.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlowDiagram } from '../flows/flow-parse';
import type { ChangeReview } from '../model/change-review';
import { flowRowChanges, type FlowRowChanges } from '../app/logic/change-marks';
import { ChangeDot } from '../app/components/changes/ChangeBadge';
import { buildFlowIndex, type FlowIndexNode } from './flow-nav';

function collectNodes(nodes: FlowIndexNode[], into: Map<string, FlowIndexNode>): Map<string, FlowIndexNode> {
  for (const node of nodes) {
    into.set(node.key, node);
    collectNodes(node.children, into);
  }
  return into;
}

function changeSummary({ mark, fields }: FlowRowChanges): string | null {
  if (!mark) return null;
  const kind = mark.change === 'added' ? 'Added' : 'Changed';
  return `${kind}${fields.length > 0 ? `: ${fields.join(', ')}` : ''}${mark.unexplained ? ' · unexplained' : ''}`;
}

export function FlowIndex({ diagrams, activePath, modelName, modelDescription, changeReview, onSelectPath, onClose }: {
  diagrams: FlowDiagram[];
  /** Id path of the diagram on screen, root first. */
  activePath: string[];
  modelName?: string;
  modelDescription?: string;
  /** Changes to mark on the rows; null = no marks. */
  changeReview: ChangeReview | null;
  onSelectPath: (ids: string[]) => void;
  onClose: () => void;
}) {
  const tree = useMemo(() => buildFlowIndex(diagrams, modelDescription), [diagrams, modelDescription]);
  const nodesByKey = useMemo(() => collectNodes(tree, new Map()), [tree]);
  const changesByKey = useMemo(() => {
    const changes = new Map<string, FlowRowChanges>();
    if (changeReview) {
      for (const node of nodesByKey.values()) changes.set(node.key, flowRowChanges(changeReview, node.key, node.opensOwnDiagram));
    }
    return changes;
  }, [nodesByKey, changeReview]);
  const activeKey = activePath.join('/');
  const currentNode = [...nodesByKey.values()].find(n => n.opensOwnDiagram && n.path.join('/') === activeKey);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const preview = (hoverKey !== null ? nodesByKey.get(hoverKey) : undefined)
    ?? (focusKey !== null ? nodesByKey.get(focusKey) : undefined)
    ?? currentNode;
  const previewChanges = preview ? changesByKey.get(preview.key) : undefined;
  const previewSummary = previewChanges ? changeSummary(previewChanges) : null;
  const currentRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'center' });
    currentRowRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function renderNode(node: FlowIndexNode) {
    const pathKey = node.path.join('/');
    const isCurrent = node === currentNode;
    const onActivePath = node.opensOwnDiagram && !isCurrent && activeKey.startsWith(`${pathKey}/`);
    const changes = changesByKey.get(node.key);
    const classes = [
      'flow-index__pill',
      isCurrent ? 'flow-index__pill--current' : '',
      onActivePath ? 'flow-index__pill--ancestor' : '',
      node.opensOwnDiagram ? '' : 'flow-index__pill--leaf',
    ].filter(Boolean).join(' ');
    return (
      <li key={node.key} className="flow-index__item">
        <button
          type="button"
          ref={isCurrent ? currentRowRef : undefined}
          className={classes}
          data-ignatius="flow-index-row"
          data-path={pathKey}
          data-change={changes?.mark?.change}
          data-unexplained={changes?.mark?.unexplained ? 'true' : undefined}
          aria-current={isCurrent ? 'page' : undefined}
          onClick={() => onSelectPath(node.path)}
          onMouseEnter={() => setHoverKey(node.key)}
          onFocus={() => setFocusKey(node.key)}
        >
          {node.number && <span className="flow-index__num">{node.number}</span>}
          <span className="flow-index__label">{node.label}</span>
          <ChangeDot severity={changes?.inside ?? null} />
        </button>
        {node.children.length > 0 && (
          <ul className="flow-index__children">{node.children.map(renderNode)}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="flow-index" data-ignatius="flow-index" role="dialog" aria-label="Flow index">
      <div className="flow-index__tree" onMouseLeave={() => setHoverKey(null)}>
        <div className="flow-index__head">
          <span className="flow-index__title">{modelName ? `${modelName} process hierarchy` : 'Process hierarchy'}</span>
          <button type="button" className="flow-index__close" aria-label="Close flow index" onClick={onClose}>✕</button>
        </div>
        <ul aria-label="Process hierarchy" className="flow-index__list">{tree.map(renderNode)}</ul>
      </div>
      <aside className="flow-index__pane" data-ignatius="flow-index-pane">
        {!preview && (
          <>
            <h3 className="flow-index__pane-title">{modelName ?? 'Process flows'}</h3>
            <p className={modelDescription ? 'flow-index__pane-desc' : 'flow-index__pane-desc flow-index__pane-desc--empty'}>
              {modelDescription ?? 'No description.'}
            </p>
          </>
        )}
        {preview && (
          <>
            <h3 className="flow-index__pane-title">{preview.number ? `${preview.number} ${preview.label}` : preview.label}</h3>
            {previewSummary && <p className="flow-index__pane-change" data-ignatius="flow-index-change">{previewSummary}</p>}
            <p className={preview.description ? 'flow-index__pane-desc' : 'flow-index__pane-desc flow-index__pane-desc--empty'}>
              {preview.description ?? 'No description.'}
            </p>
            <p className="flow-index__pane-hint">
              {preview.opensOwnDiagram
                ? `Opens its diagram${preview.children.length > 0 ? ` (${preview.children.length} ${preview.children.length === 1 ? 'process' : 'processes'})` : ''}.`
                : 'No diagram of its own; opens the diagram that contains it.'}
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
