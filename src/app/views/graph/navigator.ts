import cytoscape from 'cytoscape';
import cytoscapeNavigator from 'cytoscape-navigator';
import 'cytoscape-navigator/cytoscape.js-navigator.css';

// @ts-expect-error — same interop gap; .use() exists at runtime
cytoscape.use(cytoscapeNavigator);

export type NavigatorInstance = {
  destroy: () => void;
  _onRenderHandler?: { cancel?: () => void };
  // Prototype method on the Navigator instance (cytoscape-navigator.js:323) that
  // removes the cy listeners the navigator added — including the 'resize' listener
  // (added at :391) and `cy.offRender(this._onRenderHandler)`.
  _removeCyListeners?: () => void;
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
  nav._onRenderHandler?.cancel?.();
  // Plugin bug: cytoscape-navigator's destroy() (cytoscape-navigator.js:355) only
  // calls _removeEventsHandling() (overlay + window listeners) — it NEVER calls
  // _removeCyListeners(), so the navigator's cy 'resize' listener (added at :391)
  // stays attached after destroy(). A trailing cy 'resize' — including one emitted
  // while cy.destroy() tears the core down — then fires Navigator.resize →
  // boundingBox on a core whose _private is null → "Cannot read properties of null
  // (reading 'isHeadless')". So remove the cy listeners ourselves while the cy is
  // still alive (GraphView calls cy.destroy() only AFTER teardownNavigator).
  nav._removeCyListeners?.();
  nav.destroy();
  if (container) while (container.firstChild) container.removeChild(container.firstChild);
}
