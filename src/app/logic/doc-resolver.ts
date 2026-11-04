import type { Model } from '../../model/parse';
import type { FlowDiagram, FlowProcess, FlowExternal, FlowStoreRef } from '../../flows/flow-parse';
import { diagramRef } from '../../flow-view/flow-nav';
import { SYNTHETIC_DIAGRAM_IDS } from '../../flows/flow-derive-levels';
import { targetCandidates } from '../../model/wikilink';

export type FlowDoc = { title: string; bodyHtml: string };

/**
 * Discriminated result from the flow doc resolver.
 * - `entity` — token maps to an ERD entity; open the rich SelectedEntityModal.
 * - `node`   — token maps to a structured flow node (process/external/non-db store);
 *              open the facts-rich FlowNodeModal (I/O table or kind+refs + markdown body).
 * - `doc`    — token maps to a plain markdown doc with no structured node (wiki-links
 *              that cannot be enriched, or the empty-state fallback for absent entities).
 * - `diagram` — a bare `[[wiki-link]]` names a process that owns a sub-DFD; open that
 *              diagram (a `dfd=` reference) in the Flows view.
 *
 * A process `node` result carries `inDiagramRef`, the diagram it is drawn in, and a decomposed
 * process also its sub-DFD's `diagramRef`.
 */
export type FlowDocResult =
  | { kind: 'entity'; entityId: string }
  | { kind: 'node'; node: FlowProcess | FlowExternal | FlowStoreRef; allProcesses: FlowProcess[]; doc: FlowDoc; diagramRef?: string; inDiagramRef?: string }
  | { kind: 'doc'; doc: FlowDoc }
  | { kind: 'diagram'; diagramRef: string };

/** The doc token that names a flow node: `proc:<id>`, `ext:<id>`, or `<store kind>:<name>`. */
export function nodeToken(node: FlowProcess | FlowExternal | FlowStoreRef): string {
  if ('inputs' in node) return `proc:${node.id}`;
  if ('displayName' in node) return `${node.kind}:${node.name}`;
  return `ext:${node.id}`;
}

/** `opened` a node dialog (its token and title), `closed` it, or `left` it for another screen or dialog. */
export type NodeDialogListener = (dialog: { token: string; title: string } | null, reason: 'opened' | 'closed' | 'left') => void;

/** Split a doc token into kind prefix + bare name. A bare token (from a
 *  `[[wiki-link]]`) has no kind prefix. */
export function splitDocToken(token: string): { kind: string | null; name: string } {
  const colon = token.indexOf(':');
  if (colon === -1) return { kind: null, name: token };
  return { kind: token.slice(0, colon), name: token.slice(colon + 1) };
}

/**
 * Build a resolver mapping a doc token to a discriminated result:
 * - `{kind:'entity', entityId}` for `db:` tokens and bare wiki-link tokens
 *   whose name matches a known ERD entity — the caller opens the rich
 *   SelectedEntityModal.
 * - `{kind:'node', node, allProcesses, doc}` for process / external / non-`db`
 *   store tokens — the caller opens the facts-rich FlowNodeModal.
 * - `{kind:'diagram', diagramRef}` for a bare token naming a process that owns
 *   a sub-DFD — the caller opens that diagram.
 * - `null` for tokens that cannot be resolved in any namespace (absent
 *   entity, unknown process, etc.) — caller shows an empty-state fallback.
 *
 * Tokens are either kind-qualified (`proc:Validate`, `ext:Customer`,
 * `db:Party`, `cache:Session`) from a node's ⓘ badge, or bare (`Party`)
 * from a `[[wiki-link]]`.
 */
export function buildFlowDocResolver(
  diagrams: FlowDiagram[],
  // Accepts a getter so callers can pass () => modelRef.current — the resolver
  // then reads the LIVE entity-id set on every call, not a snapshot baked at
  // effect-run time. A plain Model value is still accepted for static mode
  // (where the model never changes).
  getEntityModel: (() => Model | undefined) | Model | undefined,
): (token: string) => FlowDocResult | null {
  // Structured node maps: stores the full typed node for facts rendering.
  const processById = new Map<string, FlowProcess>();
  // Keyed by stable id/slug (NOT by display label) so that a `title:` override
  // on an external does not break `[[Customer]]` or `ext:Customer` resolution.
  const externalById = new Map<string, FlowExternal>();
  const storesByKindName = new Map<string, FlowStoreRef>();
  const storesByName = new Map<string, FlowStoreRef>();
  // Flat list of all processes (needed for FlowIoTable's allProcesses param).
  const allProcesses: FlowProcess[] = [];

  const diagramRefByProcess = new Map<string, string>();
  const inDiagramRefByProcess = new Map<string, string>();

  function walk(d: FlowDiagram, path: FlowDiagram[]) {
    const here = [...path, d];
    for (const p of d.processes) {
      if (!processById.has(p.id)) {
        processById.set(p.id, p);
        allProcesses.push(p);
      }
      if (!SYNTHETIC_DIAGRAM_IDS.has(d.id) && !inDiagramRefByProcess.has(p.id)) inDiagramRefByProcess.set(p.id, diagramRef(here));
      const sub = d.subDfds.find(child => child.id === p.id);
      if (sub && !diagramRefByProcess.has(p.id)) diagramRefByProcess.set(p.id, diagramRef([...here, sub]));
    }
    for (const e of d.externals) {
      if (!externalById.has(e.id)) externalById.set(e.id, e);
    }
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') {
        if (!storesByKindName.has(`${s.kind}:${s.name}`)) storesByKindName.set(`${s.kind}:${s.name}`, s);
        if (!storesByName.has(s.name)) storesByName.set(s.name, s);
      }
    }
    for (const sub of d.subDfds) walk(sub, here);
  }
  for (const d of diagrams) walk(d, []);

  function processResult(proc: FlowProcess): FlowDocResult {
    return {
      kind: 'node',
      node: proc,
      allProcesses,
      doc: { title: proc.label || proc.id, bodyHtml: proc.bodyHtml },
      diagramRef: diagramRefByProcess.get(proc.id),
      inDiagramRef: inDiagramRefByProcess.get(proc.id),
    };
  }

  // Normalize: if a plain Model (or undefined) was passed, wrap it in a getter
  // so the resolution path below is uniform.
  const getModel: () => Model | undefined =
    typeof getEntityModel === 'function'
      ? getEntityModel
      : () => getEntityModel;

  return (token: string): FlowDocResult | null => {
    // Read the live entity-id set on every resolution so SSE-updated models
    // are classified correctly without re-running the flow effect.
    const currentModel = getModel();
    const entityIds = currentModel
      ? new Set(currentModel.nodes.map(n => n.id))
      : new Set<string>();

    const { kind, name } = splitDocToken(token);
    // Kind-qualified: resolve against that namespace first.
    if (kind === 'proc') {
      const proc = processById.get(name);
      return proc ? processResult(proc) : null;
    }
    if (kind === 'ext') {
      const ext = externalById.get(name);
      if (!ext) return null;
      return { kind: 'node', node: ext, allProcesses, doc: { title: ext.label, bodyHtml: ext.bodyHtml } };
    }
    // db: tokens always route to the rich entity dialog (if entity exists).
    if (kind === 'db') {
      return entityIds.has(name) ? { kind: 'entity', entityId: name } : null;
    }
    if (kind) {
      const store = storesByKindName.get(`${kind}:${name}`);
      if (store) return { kind: 'node', node: store, allProcesses, doc: { title: store.displayName, bodyHtml: store.bodyHtml ?? '' } };
    }
    // Bare token (wiki-link): entity first, since narratives mostly cross-link entities, then flow nodes.
    for (const id of targetCandidates(name)) {
      if (entityIds.has(id)) return { kind: 'entity', entityId: id };
      const ref = diagramRefByProcess.get(id);
      if (ref !== undefined) return { kind: 'diagram', diagramRef: ref };
      const proc = processById.get(id);
      if (proc) return processResult(proc);
      const ext = externalById.get(id);
      if (ext) return { kind: 'node', node: ext, allProcesses, doc: { title: ext.label, bodyHtml: ext.bodyHtml } };
      const store = storesByName.get(id);
      if (store) return { kind: 'node', node: store, allProcesses, doc: { title: store.displayName, bodyHtml: store.bodyHtml ?? '' } };
    }
    return null;
  };
}
