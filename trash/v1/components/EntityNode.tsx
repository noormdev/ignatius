import { Handle, Position } from '@xyflow/react';
import type { Node as EntityNodeData } from '../engine';

interface NodeData {
  entity: EntityNodeData;
}

const BADGE: Record<string, string> = {
  basetype: 'B',
  subtype: 'S',
  associative: 'A',
  classifier: 'C',
  dependent: 'D',
  independent: 'I',
};

export function EntityNode({ data }: { data: NodeData }) {
  const e = data.entity;
  const pkCols = e.columns.filter(c => c.isPK);
  const fkCols = e.columns.filter(c => c.isFK && !c.isPK);
  const akOnlyCols = e.columns.filter(c => !c.isPK && !c.isFK && c.akMembership.length > 0);
  const otherCount = e.columns.length - pkCols.length - fkCols.length - akOnlyCols.length;

  return (
    <div className={`entity-node ${e.classification}`}>
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Left} id="l" />
      <div className="header">
        <span>{e.name}</span>
        <span className="badge">{BADGE[e.classification] ?? '?'}</span>
        {e.primaryGroup && <span className="group-tag">{e.primaryGroup}</span>}
      </div>
      <div className="columns">
        {pkCols.length > 0 && (
          <>
            <div className="col section-head"><span>PK</span></div>
            {pkCols.map(c => (
              <div className="col" key={c.name}>
                <span className="name pk">{c.name}</span>
                <span className="meta">{c.type}</span>
              </div>
            ))}
          </>
        )}
        {fkCols.length > 0 && (
          <>
            <div className="col section-head"><span>FK</span></div>
            {fkCols.map(c => (
              <div className="col" key={c.name}>
                <span className="name fk">{c.name}{c.nullable ? '?' : ''}</span>
                <span className="meta">{c.type}</span>
              </div>
            ))}
          </>
        )}
        {akOnlyCols.length > 0 && (
          <>
            <div className="col section-head"><span>AK</span></div>
            {akOnlyCols.map(c => (
              <div className="col" key={c.name}>
                <span className="name">{c.name}{c.nullable ? '?' : ''}</span>
                <span className="meta">{c.type}</span>
              </div>
            ))}
          </>
        )}
      </div>
      {otherCount > 0 && (
        <div className="more">+{otherCount} more</div>
      )}
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
}
