import type cytoscape from 'cytoscape';
import type { FlowDiagram } from '../flows/flow-parse';

declare global {
  interface Window {
    __MODEL__?: import('../parse').Model;
    __THEME_MODE__?: 'dark' | 'light';
    __IGNATIUS_MODE__?: 'live' | 'static';
    __LAYOUT_KEY__?: string;
    // Flow-mode globals: injected by generateApp (export) or fetched from /api/flow (live).
    // __FLOW_MODEL__ is the array of all top-level FlowDiagrams (each carries
    // its subDfds recursively so drill-down works client-side with no fetches).
    __FLOW_MODEL__?: FlowDiagram[];
    // __FLOW_LAYOUT_KEYS__ maps diagram id → structural fingerprint for every
    // diagram in the tree (top-level and sub-DFDs). The frontend looks up
    // the key by id rather than importing the fingerprint module.
    __FLOW_LAYOUT_KEYS__?: Record<string, string>;
    // Debug/test seam: the live Cytoscape core, exposed for the visual harness
    // to locate nodes and drive hover. Not read by application code.
    __IGNATIUS_CY__?: cytoscape.Core;
    // Generation counter: incremented each time a new Cytoscape instance is
    // assigned to __IGNATIUS_CY__. Lets the visual harness detect a rebuild
    // even when the teardown→rebuild cycle is too fast to observe the undefined state.
    __IGNATIUS_CY_GEN__?: number;
    // Flow surface ready-flag: set to true once the SVG renderer has mounted.
    // Used by the visual test harness to confirm the flow render path ran.
    __IGNATIUS_FLOW_READY__?: boolean;
    // Generation counter for flow renders: incremented each time FLOW_READY goes true.
    // Lets the visual harness detect a re-render even when the false→true cycle is
    // too fast to observe via polling.
    __IGNATIUS_FLOW_GEN__?: number;
    // Test seam: the id of the currently active top-level DFD. Updated by the
    // flow renderer's onDiagramChange callback so the visual harness can assert
    // DFD-preserve across SSE re-renders without DOM parsing.
    __IGNATIUS_ACTIVE_FLOW_DFD__?: string;
    // Perf marker: stamped inside cy.one('layoutstop') so the measurement harness
    // can read parse + layout timing without instrumenting the render loop.
    // Read-only from outside; no layout behavior is changed.
    __IGNATIUS_PERF__?: {
      layoutStopAt: number;    // performance.now() at layoutstop
      nodes: number;           // cytoscape node count (non-parent, excludes cluster boxes)
      edges: number;           // cytoscape edge count
      layoutMode: 'elk' | 'preset'; // which layout path ran
    };
  }
}
