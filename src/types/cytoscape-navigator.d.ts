/**
 * Minimal ambient declarations for cytoscape-navigator 2.x.
 *
 * The package has no @types — this covers the surface we use:
 *   import cytoscapeNavigator from 'cytoscape-navigator';
 *   cytoscape.use(cytoscapeNavigator);
 *   const nav = cy.navigator({ container: el });
 *   nav.destroy();
 *
 * WHY default export: moduleResolution "bundler" + Bun's CJS interop lets us
 * import CJS default-style without esModuleInterop. The plugin's module.exports
 * is a function, so the default import is that function.
 */

declare module 'cytoscape-navigator' {
  import type cytoscape from 'cytoscape';

  interface NavigatorOptions {
    /** HTML element to mount the minimap into. */
    container?: HTMLElement | string | false;
    /** Frames per second for live pan tracking. 0 = instant, false = on drag-end only. */
    viewLiveFramerate?: number | false;
    /** Max thumbnail updates per second triggered by graph events. */
    thumbnailEventFramerate?: number;
    /** Max thumbnail updates per second always. False to disable. */
    thumbnailLiveFramerate?: number | false;
    /** Double-click delay in ms. */
    dblClickDelay?: number;
    /** Destroy the container element on plugin destroy. */
    removeCustomContainer?: boolean;
    /** Rerender throttle in ms. */
    rerenderDelay?: number;
  }

  interface NavigatorInstance {
    destroy(): void;
  }

  /** The register function — pass to cytoscape.use(). */
  type RegisterFn = import('cytoscape').Ext;

  const cytoscapeNavigator: RegisterFn;
  export default cytoscapeNavigator;
}

// Augment the cytoscape Core type so cy.navigator() is typed.
declare module 'cytoscape' {
  interface Core {
    navigator(options?: import('cytoscape-navigator').NavigatorOptions): import('cytoscape-navigator').NavigatorInstance;
  }
}
