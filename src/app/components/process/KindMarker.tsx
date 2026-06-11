import type { FlowEndpoint, FlowProcess } from '../../../flows/flow-parse';

// Kind markers: short labels for the inputs/outputs table (mirrors flow-dict.ts)
export const FLOW_KIND_MARKERS: Record<string, string> = {
  db: 'D',
  cache: 'C',
  queue: 'Q',
  file: 'F',
  doc: 'Do',
  manual: 'M',
  ext: '',
  proc: '',
};

export function KindMarker({ ep, processes }: { ep: FlowEndpoint; processes: FlowProcess[] }) {
  if (ep.kind === 'proc') {
    const proc = processes.find(p => p.id === ep.name);
    const label = proc ? proc.dottedNumber : ep.name;
    return <span className="flow-kind-marker">{label}</span>;
  }
  if (ep.kind === 'ext') {
    return <span className="flow-kind-ext">ext</span>;
  }
  const marker = FLOW_KIND_MARKERS[ep.kind] ?? ep.kind;
  const isDb = ep.kind === 'db';
  return (
    <span className={`flow-kind-marker${isDb ? ' flow-kind-marker--db' : ''}`}>
      {marker}
    </span>
  );
}
