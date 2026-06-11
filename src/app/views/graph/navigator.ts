import cytoscape from 'cytoscape';
import cytoscapeNavigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css';

// @ts-expect-error — same interop gap; .use() exists at runtime
cytoscape.use(cytoscapeNavigator);

export type NavigatorInstance = {
  destroy: () => void;
  _onRenderHandler?: { cancel?: () => void };
};

export function mountNavigator(cy: cytoscape.Core): NavigatorInstance {
  // The plugin only honors `container` as a string selector ('#id' or '.class').
  // Passing an HTMLElement falls through to `document.body.appendChild` of its own
  // div — see cytoscape-navigator.js:378-389. Use the id selector path.
  const nav = (cy as cytoscape.Core & {
    navigator: (opts: Record<string, unknown>) => NavigatorInstance;
  }).navigator({
    container: '#minimap-panel',
    viewLiveFramerate: 0,
    rerenderDelay: 100,
    removeCustomContainer: false,
  });
  // The plugin only generates the thumbnail on cy.onRender events. After
  // layoutstop the graph is idle so no render fires; force one so the
  // initial thumbnail paints.
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).resize();
  (cy as cytoscape.Core & { resize: () => void; trigger: (e: string) => void }).trigger('render');
  return nav;
}

export function teardownNavigator(nav: NavigatorInstance, container: HTMLElement | null) {
  // Cancel the throttled render handler's pending trailing setTimeout BEFORE
  // nav.destroy() — otherwise the tick can fire after cy.destroy() nulls
  // the renderer and throw "Cannot read properties of null (reading 'png')".
  // nav.destroy() also unsubscribes the navigator's cy 'resize' listener, so it
  // must run even when the container is already unmounted — otherwise a leaked
  // navigator boundingBox-es a destroyed core on a trailing resize ('isHeadless'
  // of null). Hence the container is optional and only used to clear children.
  nav._onRenderHandler?.cancel?.();
  nav.destroy();
  if (container) while (container.firstChild) container.removeChild(container.firstChild);
}
