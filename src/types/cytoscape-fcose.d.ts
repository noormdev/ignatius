/**
 * Minimal ambient declarations for cytoscape-fcose 2.x.
 *
 * The package has no @types. We only need the register function so
 * `cytoscape.use(fcose)` type-checks; the layout options object is passed
 * through `cy.layout()` and cast to `cytoscape.LayoutOptions` at the call
 * site (fCoSE is an extension layout the core union does not know about).
 *
 * WHY default export: the plugin's module.exports is the register function,
 * so the CJS default import under moduleResolution "bundler" is that function.
 */

declare module 'cytoscape-fcose' {
  type RegisterFn = import('cytoscape').Ext;
  const cytoscapeFcose: RegisterFn;
  export default cytoscapeFcose;
}
