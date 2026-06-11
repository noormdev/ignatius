import { useEffect, useRef, useState } from 'react';
import { parseHash, serializeHash } from '../hash-router';
import type { HashState, ViewName } from '../hash-router';

export type UseHashRouteOptions = {
  // Called when a popstate event lands on the flow view with a dfd= param.
  // The shell passes `(id) => flowsViewRef.current?.selectDiagramById(id)`.
  onRestoreDfd?: (dfdId: string) => void;
};

// Owns hash read/write and popstate/hashchange back/forward restoration.
// Returns the active view and a setter that also writes view into the hash.
export function useHashRoute(opts?: UseHashRouteOptions): {
  view: ViewName;
  setView: (v: ViewName) => void;
} {
  const [view, setViewState] = useState<ViewName>(() => {
    const fromHash = parseHash(location.hash).view;
    return fromHash ?? 'graph';
  });

  // Ref so the popstate closure always reads the current view.
  const viewRef = useRef<ViewName>(view);
  viewRef.current = view;

  // Ref so the popstate closure captures the latest callback without stale closure.
  const onRestoreDfdRef = useRef(opts?.onRestoreDfd);
  onRestoreDfdRef.current = opts?.onRestoreDfd;

  // Write view into hash whenever it changes (does not clobber entity/zoom/pan).
  useEffect(() => {
    const current = parseHash(location.hash);
    const next: HashState = { ...current, view };
    const serialized = serializeHash(next);
    history.replaceState({}, '', serialized ? '#' + serialized : location.pathname);
  }, [view]);

  // Back/forward navigation: read #view= and #dfd= from hash and update state.
  useEffect(() => {
    function onPopState() {
      const fromHash = parseHash(location.hash);
      const newView = fromHash.view;
      if (newView && newView !== viewRef.current) {
        setViewState(newView);
      }
      // When staying on (or navigating back to) the flow view, swap the DFD
      // client-side via the registered selectDiagramById handler.
      const newDfd = fromHash.dfd;
      if (newDfd && (newView === 'flow' || viewRef.current === 'flow')) {
        onRestoreDfdRef.current?.(newDfd);
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

  return { view, setView };
}
