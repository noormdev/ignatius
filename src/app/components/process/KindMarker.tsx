import type { FlowEndpoint, FlowProcess } from '../../../flows/flow-parse';
import { FLOW_STORE_KIND_SYMBOLS } from '../../../theme/theme-defaults';


export function KindMarker({ ep, processes }: { ep: FlowEndpoint; processes: FlowProcess[] }) {
  if (ep.kind === 'proc') {
    const proc = processes.find(p => p.id === ep.name);
    const label = proc ? proc.dottedNumber : ep.name;
    return <span className="flow-kind-marker">{label}</span>;
  }
  if (ep.kind === 'ext') {
    return <span className="flow-kind-ext">ext</span>;
  }
  const marker = FLOW_STORE_KIND_SYMBOLS[ep.kind];
  const isDb = ep.kind === 'db';
  return (
    <span className={`flow-kind-marker${isDb ? ' flow-kind-marker--db' : ''}`}>
      {marker}
    </span>
  );
}
