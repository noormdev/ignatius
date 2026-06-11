import type { FlowDiagram } from '../../flows/flow-parse';
import type { Model } from '../../model/parse';

/**
 * Walk all flow diagrams (recursively) and collect every known node ID —
 * entity IDs (from the ERD model), process IDs, external IDs, and non-db
 * store names — into a single Set. Used by FlowNodeModal and the flow-opened
 * SelectedEntityModal to upgrade `.entity-link--missing` spans to live links.
 */
export function buildAllFlowNodeIds(
  diagrams: FlowDiagram[],
  entityModel?: Model,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (entityModel) {
    for (const n of entityModel.nodes) ids.add(n.id);
  }
  function walk(d: FlowDiagram) {
    for (const p of d.processes) ids.add(p.id);
    for (const e of d.externals) ids.add(e.id);
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') ids.add(s.name);
    }
    for (const sub of d.subDfds) walk(sub);
  }
  diagrams.forEach(walk);
  return ids;
}
