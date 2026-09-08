import type { StackNodeData, StackRow, StackMember } from '../../../flow-view/flow-layout';
import type { FlowCluster } from '../../../flows/flow-clusters';
import type { GroupConfig } from '../../../model/parse';
import { Modal } from '../ui/Modal';

/** Strips a grouped-node id's `<prefix>` and `--read`/`--write` direction
 *  suffix, leaving the bare slug/basetype/group name the id encodes. */
function bareIdAfter(prefix: string, id: string): string {
  return id.slice(prefix.length).replace(/--(read|write)$/, '');
}

/** Indent per nesting level, one level per StackRow depth — matches the
 *  dictionary sidebar's `.dict-nav-subtype` indent. */
const ROW_INDENT_PX = 16;

/**
 * One row of a stack's breakdown, at the current collapse level. A `store`
 * row opens its entity dialog directly; a `cluster`/`subtype`/`group` row is
 * a `<details>` toggle (the repo's expand affordance — see ExamplesAccordion)
 * that reveals its members (or nested rows, for a group) with D#s, indented
 * one level under it.
 */
function StackDialogRow({ row, depth, memberIndex, onOpenEntity }: {
  row: StackRow;
  depth: number;
  memberIndex: ReadonlyMap<string, StackMember>;
  onOpenEntity: (token: string) => void;
}) {
  const indent = depth > 0 ? { paddingLeft: depth * ROW_INDENT_PX } : undefined;

  if (row.kind === 'store') {
    return (
      <tr>
        <td style={indent}>
          <a
            href={`#entity-${row.storeId}`}
            className="entity-link"
            onClick={e => { e.preventDefault(); onOpenEntity(row.storeId); }}
          >
            D{row.storeNum} {row.displayName}
          </a>
        </td>
      </tr>
    );
  }

  const childRows: StackRow[] = row.children ?? row.memberIds.map(id => {
    const m = memberIndex.get(id);
    return { kind: 'store' as const, storeId: id, displayName: m?.displayName ?? id, storeNum: m?.storeNum ?? 0 };
  });

  return (
    <>
      <tr>
        <td style={indent}>
          <details className="stack-dialog-row-toggle">
            <summary>{row.cap} {row.label} ({row.count})</summary>
          </details>
        </td>
      </tr>
      {childRows.map((child, i) => (
        <StackDialogRow key={i} row={child} depth={depth + 1} memberIndex={memberIndex} onOpenEntity={onOpenEntity} />
      ))}
    </>
  );
}

/** A process id rendered as its dotted-number + label, linking to its dialog. */
function ProcessLink({ processId, processLabelById, onOpenEntity }: {
  processId: string;
  processLabelById: ReadonlyMap<string, string>;
  onOpenEntity: (token: string) => void;
}) {
  return (
    <a
      href={`#process-${processId}`}
      className="entity-link"
      onClick={e => { e.preventDefault(); onOpenEntity(`proc:${processId}`); }}
    >
      {processLabelById.get(processId) ?? processId}
    </a>
  );
}

/**
 * Extra content by the stack's grouping source (docs/design/dfd-store-clusters.md
 * Interaction): an author cluster's markdown body, a subtype row's link to
 * the basetype entity, a group's description, or — adjacency, which has no
 * `clusters/` file to draw a body from — the shared reader/writer processes.
 */
function StackDialogExtra({ node, clusters, groups, processLabelById, onOpenEntity }: {
  node: StackNodeData;
  clusters: FlowCluster[];
  groups: Record<string, GroupConfig>;
  processLabelById: ReadonlyMap<string, string>;
  onOpenEntity: (token: string) => void;
}) {
  if (node.source === 'cluster') {
    const slug = bareIdAfter('cluster:', node.id);
    const cluster = clusters.find(c => c.slug === slug);
    if (!cluster?.bodyHtml) return null;
    return (
      <div className="doc-section">
        <h2>About</h2>
        <div className="doc-body" dangerouslySetInnerHTML={{ __html: cluster.bodyHtml }} />
      </div>
    );
  }

  if (node.source === 'subtype') {
    const basetype = bareIdAfter('subtype:', node.id);
    return (
      <div className="doc-section">
        <h2>Basetype</h2>
        <a
          href={`#entity-db:${basetype}`}
          className="entity-link"
          onClick={e => { e.preventDefault(); onOpenEntity(`db:${basetype}`); }}
        >
          {basetype}
        </a>
      </div>
    );
  }

  if (node.source === 'group') {
    const name = bareIdAfter('group:', node.id);
    const desc = groups[name]?.desc ?? groups[name]?.description;
    if (!desc) return null;
    return (
      <div className="doc-section">
        <h2>About</h2>
        <p>{desc}</p>
      </div>
    );
  }

  if (node.source === 'adjacency') {
    const writers = node.adjacencyWriters ?? [];
    const readers = node.adjacencyReaders ?? [];
    const joinLinks = (ids: string[]) =>
      ids.length === 0
        ? '—'
        : ids.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <ProcessLink processId={id} processLabelById={processLabelById} onOpenEntity={onOpenEntity} />
            </span>
          ));
    return (
      <div className="doc-section">
        <h2>Processes</h2>
        <table className="dict-io-table">
          <thead>
            <tr><th>Role</th><th>Process</th></tr>
          </thead>
          <tbody>
            <tr><td>Writers</td><td>{joinLinks(writers)}</td></tr>
            <tr><td>Readers</td><td>{joinLinks(readers)}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

const STACK_TITLES: Record<'read' | 'write', string> = { read: 'Read stack', write: 'Write stack' };

/**
 * StackDialog — a stack node's row breakdown at the current collapse level,
 * plus grouping-source-specific extra content. Opened through the same
 * FlowSurface dialog state the node and contract dialogs use; opening a
 * member's entity dialog closes this one first (FlowSurface's existing
 * dialog-close-before-entity-open rule).
 */
export function StackDialog({ node, feederProcessLabels, processLabelById, clusters, groups, onClose, onOpenEntity }: {
  node: StackNodeData;
  /** Dotted-number + label of every process whose edge feeds this stack. */
  feederProcessLabels: string[];
  /** Process id → dotted-number + label, for an adjacency stack's reader/writer links. */
  processLabelById: ReadonlyMap<string, string>;
  clusters: FlowCluster[];
  groups: Record<string, GroupConfig>;
  onClose: () => void;
  /** Opens a member's entity/doc dialog, closing this one first. */
  onOpenEntity: (token: string) => void;
}) {
  const memberIndex = new Map(node.members.map(m => [m.storeId, m]));
  const title = node.source === 'per-process' ? STACK_TITLES[node.direction] : node.label;
  const headerExtra = feederProcessLabels.length > 0
    ? <div className="modal-badges"><span className="pk-label">{feederProcessLabels.join(', ')}</span></div>
    : undefined;

  return (
    <Modal title={title} onClose={onClose} headerExtra={headerExtra}>
      <div className="doc-section">
        <h2>Members</h2>
        <div className="flow-table-wrap">
          <table className="dict-io-table">
            <thead>
              <tr><th>Store</th></tr>
            </thead>
            <tbody>
              {node.rows.map((row, i) => (
                <StackDialogRow key={i} row={row} depth={0} memberIndex={memberIndex} onOpenEntity={onOpenEntity} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <StackDialogExtra node={node} clusters={clusters} groups={groups} processLabelById={processLabelById} onOpenEntity={onOpenEntity} />
    </Modal>
  );
}
