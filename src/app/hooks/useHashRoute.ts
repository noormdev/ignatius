import { useEffect, useRef, useState } from 'react';
import { parseHash, serializeHash } from '../hash-router';
import type { HashState, ViewName } from '../hash-router';

export type UseHashRouteOptions = {
  // Called when a popstate event lands on the flow view with a dfd= param.
  // The shell passes `(id) => flowsViewRef.current?.selectDiagramById(id)`.
  onRestoreDfd?: (dfdId: string) => void;
  // Called on a popstate reconcile when the hash's entity= differs from what the
  // shell last opened. Argument is the new entity id (open/switch the modal) or
  // null (close it). The shell MUST NOT push history in response — this fires
  // because the user already navigated (Back/Forward).
  onEntityChange?: (entityId: string | null) => void;
};

// Owns hash read/write and popstate/hashchange back/forward restoration, AND the
// browser-history lifecycle of the entity modal (entity= is the single source of
// truth for "which modal is open"). The shell mirrors modal React state from the
// open/close helpers and the onEntityChange reconcile.
export function useHashRoute(opts?: UseHashRouteOptions): {
  view: ViewName;
  setView: (v: ViewName) => void;
  // Push a history entry whose hash carries entity=<id>. Dedups: if the current
  // hash already carries this same entity, no new entry is pushed.
  openEntity: (id: string) => void;
  // Clear entity= from the CURRENT entry via replaceState (clean URL, no new
  // history step). Distinct from browser Back, which unwinds the modal stack.
  closeEntity: () => void;
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

  // The entity= we last reconciled to (opened/closed via). Mirrors the hash's
  // entity field. Seeded from the initial hash so a deep-link does not trip a
  // spurious reconcile against an empty baseline. null = no modal open.
  const entityRef = useRef<string | null>(parseHash(location.hash).entity ?? null);

  // Write view into hash whenever it changes (does not clobber entity/zoom/pan).
  useEffect(() => {
    const current = parseHash(location.hash);
    const next: HashState = { ...current, view };
    const serialized = serializeHash(next);
    history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
  }, [view]);

  // Back/forward navigation: read the hash and reconcile view, dfd, AND entity.
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
      // Reconcile the entity modal to MATCH the hash. Reconcile never pushes
      // history (we are responding to a navigation). Only fire when the hash's
      // entity differs from what we last opened, so Back from B→A→(none) walks
      // the stack exactly once per step.
      const newEntity = fromHash.entity ?? null;
      if (newEntity !== entityRef.current) {
        entityRef.current = newEntity;
        onEntityChangeRef.current?.(newEntity);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Public setter also updates the ref so same-tick reads see the new value.
  function setView(v: ViewName) {
    viewRef.current = v;
    setViewState(v);
  }

  function openEntity(id: string) {
    const current = parseHash(location.hash);
    // Dedup: an FK hop A→A or a re-open of the same entity must not stack a
    // duplicate history entry.
    if (current.entity === id) {
      entityRef.current = id;
      return;
    }
    const next: HashState = { ...current, entity: id };
    const serialized = serializeHash(next);
    history.pushState({}, '', serialized ? '#' + serialized : location.pathname);
    entityRef.current = id;
  }

  function closeEntity() {
    const current = parseHash(location.hash);
    if (current.entity === undefined) {
      entityRef.current = null;
      return;
    }
    const next: HashState = { ...current };
    delete next.entity;
    const serialized = serializeHash(next);
    history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
    entityRef.current = null;
  }

  return { view, setView, openEntity, closeEntity };
}
