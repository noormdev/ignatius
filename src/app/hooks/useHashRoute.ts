import { useEffect, useRef, useState } from 'react';
import { parseHash } from '../hash-router';
import type { HashState, ViewName, FlowViewMode, FlowCollapseLevel } from '../hash-router';
import { currentHash, navigationBase, writeHash } from '../logic/history';

export type UseHashRouteOptions = {
  // Called when a popstate event lands on the flow view with a dfd= param.
  // The shell passes `(id) => flowsViewRef.current?.selectDiagramById(id)`.
  onRestoreDfd?: (dfdId: string) => void;
  // Called on a popstate reconcile when the hash's entity= differs from what the
  // shell last opened. Argument is the new entity id (open/switch the modal) or
  // null (close it). The shell MUST NOT push history in response — this fires
  // because the user already navigated (Back/Forward).
  onEntityChange?: (entityId: string | null) => void;
  // Same contract as onEntityChange, for the flow-node dialog's node= token.
  onNodeChange?: (token: string | null) => void;
  // Same contract, for the Dictionary section= the entry was showing.
  onSectionChange?: (section: string | null) => void;
  // Called on a popstate reconcile when the hash carries a flowview=/collapse=
  // that differs from the shell's live state — a pushed history entry (e.g.
  // opening an entity) snapshots whatever flowview/collapse was current at
  // push time, so Back/Forward across such entries can restore an older
  // value even though the FAB toggle itself only replaceStates the top entry.
  onRestoreFlowView?: (view: FlowViewMode) => void;
  onRestoreCollapseLevel?: (level: FlowCollapseLevel) => void;
};

// Owns the hash and Back/Forward; push and replace rules are in docs/spec/viewer-qol.md (Navigation history).
// entity=, node=, and section= are the source of truth the shell mirrors.
export function useHashRoute(opts?: UseHashRouteOptions): {
  view: ViewName;
  /** Switch views as a navigation: pushes an entry without the old screen's dialog or section. */
  setView: (v: ViewName) => void;
  // Push a history entry whose hash carries entity=<id>. Dedups: if the current
  // hash already carries this same entity, no new entry is pushed.
  openEntity: (id: string) => void;
  // Clear entity= from the CURRENT entry via replaceState (clean URL, no new
  // history step). Distinct from browser Back, which unwinds the modal stack.
  closeEntity: () => void;
  /** Push an entry for a flow-node dialog over the current screen; `replace` adds it to the current entry instead. */
  openNode: (token: string, mode?: 'push' | 'replace') => void;
  /** Drop node= from the current entry. */
  closeNode: () => void;
  /** A node dialog gave way to another screen, whose navigation writes its own entry; Back reopens the dialog. */
  leaveNode: () => void;
  /** The same, for an entity dialog. */
  leaveEntity: () => void;
  /** Navigate to a Dictionary section (`process:Create-Sales-Order`): one pushed entry. */
  openSection: (section: string) => void;
  /** Record the section scrolled into view on the current entry. */
  replaceSection: (section: string) => void;
} {
  const [view, setViewState] = useState<ViewName>(() => {
    const fromHash = parseHash(location.hash).view;
    return fromHash ?? 'graph';
  });

  // Ref so the popstate closure always reads the current view.
  const viewRef = useRef<ViewName>(view);
  viewRef.current = view;

  // Ref so the popstate closure captures the latest callbacks without stale closure.
  const onRestoreDfdRef = useRef(opts?.onRestoreDfd);
  onRestoreDfdRef.current = opts?.onRestoreDfd;
  const onEntityChangeRef = useRef(opts?.onEntityChange);
  onEntityChangeRef.current = opts?.onEntityChange;
  const onNodeChangeRef = useRef(opts?.onNodeChange);
  onNodeChangeRef.current = opts?.onNodeChange;
  const onSectionChangeRef = useRef(opts?.onSectionChange);
  onSectionChangeRef.current = opts?.onSectionChange;
  const onRestoreFlowViewRef = useRef(opts?.onRestoreFlowView);
  onRestoreFlowViewRef.current = opts?.onRestoreFlowView;
  const onRestoreCollapseLevelRef = useRef(opts?.onRestoreCollapseLevel);
  onRestoreCollapseLevelRef.current = opts?.onRestoreCollapseLevel;

  // The entity=/node=/section= we last reconciled to. Seeded from the initial
  // hash so a deep link does not trip a spurious reconcile against an empty baseline.
  const initial = parseHash(location.hash);
  const entityRef = useRef<string | null>(initial.entity ?? null);
  const nodeRef = useRef<string | null>(initial.node ?? null);
  const sectionRef = useRef<string | null>(initial.section ?? null);

  // A first load without view= gets it written in place; every later view change
  // already wrote its own entry.
  useEffect(() => {
    const current = currentHash();
    if (current.view !== view) writeHash({ ...current, view }, 'replace');
  }, [view]);

  // Back/forward navigation: read the hash and reconcile view, dfd, and the screen params.
  useEffect(() => {
    function onPopState() {
      const fromHash = parseHash(location.hash);
      const newView = fromHash.view;
      if (newView && newView !== viewRef.current) {
        setViewState(newView);
        viewRef.current = newView;
      }
      // When staying on (or navigating back to) the flow view, swap the DFD
      // client-side via the registered selectDiagramById handler.
      const newDfd = fromHash.dfd;
      if (newDfd && (newView === 'flow' || viewRef.current === 'flow')) {
        onRestoreDfdRef.current?.(newDfd);
      }
      // Reconcile flowview=/collapse= the same way — unconditional on any
      // popstate that carries them, mirroring dfd= above.
      if (fromHash.flowview) {
        onRestoreFlowViewRef.current?.(fromHash.flowview);
      }
      if (fromHash.collapse) {
        onRestoreCollapseLevelRef.current?.(fromHash.collapse);
      }
      // Reconcile each screen param to MATCH the hash, never pushing history (we
      // are responding to a navigation), and only when it changed, so Back walks
      // the stack exactly once per step.
      const newEntity = fromHash.entity ?? null;
      if (newEntity !== entityRef.current) {
        entityRef.current = newEntity;
        onEntityChangeRef.current?.(newEntity);
      }
      const newNode = fromHash.node ?? null;
      if (newNode !== nodeRef.current) {
        nodeRef.current = newNode;
        onNodeChangeRef.current?.(newNode);
      }
      const newSection = fromHash.section ?? null;
      if (newSection !== sectionRef.current) {
        sectionRef.current = newSection;
        onSectionChangeRef.current?.(newSection);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function forgetScreen() {
    entityRef.current = null;
    nodeRef.current = null;
    sectionRef.current = null;
  }

  function setView(v: ViewName) {
    if (v !== viewRef.current) {
      writeHash({ ...navigationBase(), view: v }, 'push', true);
      forgetScreen();
    }
    viewRef.current = v;
    setViewState(v);
  }

  function openEntity(id: string) {
    const current = currentHash();
    // Dedup: an FK hop A→A or a re-open of the same entity must not stack a
    // duplicate history entry. The pushed entry drops a node dialog it was opened from.
    if (current.entity !== id) {
      const next: HashState = { ...current, entity: id };
      delete next.node;
      writeHash(next, 'push');
    }
    entityRef.current = id;
    nodeRef.current = null;
  }

  function closeEntity() {
    const next: HashState = { ...currentHash() };
    delete next.entity;
    writeHash(next, 'replace');
    entityRef.current = null;
  }

  function openNode(token: string, mode: 'push' | 'replace' = 'push') {
    const current = currentHash();
    if (current.node !== token) {
      const next: HashState = { ...current, node: token };
      delete next.entity;
      writeHash(next, mode);
    }
    nodeRef.current = token;
    entityRef.current = null;
  }

  function closeNode() {
    const next: HashState = { ...currentHash() };
    delete next.node;
    writeHash(next, 'replace');
    nodeRef.current = null;
  }

  function leaveNode() {
    nodeRef.current = null;
  }

  function leaveEntity() {
    entityRef.current = null;
  }

  function openSection(section: string) {
    writeHash({ ...navigationBase(), view: 'dict', section }, 'push');
    forgetScreen();
    sectionRef.current = section;
    viewRef.current = 'dict';
    setViewState('dict');
  }

  function replaceSection(section: string) {
    const current = currentHash();
    if (current.view !== 'dict' || current.section === section) return;
    writeHash({ ...current, section }, 'replace');
    sectionRef.current = section;
  }

  return { view, setView, openEntity, closeEntity, openNode, closeNode, leaveNode, leaveEntity, openSection, replaceSection };
}
