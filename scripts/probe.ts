// Open the dev server in a webview, wait until the React app produces a result,
// dump diagnostic info (node count, positions, any errors), then quit.

import { Webview, SizeHint } from 'webview-bun';

const url = process.argv[2] || 'http://localhost:3777';

const webview = new Webview(false, { width: 1400, height: 900, hint: SizeHint.FIXED });
webview.title = 'probe';

let exitCode = 1;

webview.bind('report', (json: string) => {
  console.log('=== REPORT ===');
  console.log(json);
  exitCode = 0;
  return 'ok';
});

webview.bind('logFromPage', (...args: unknown[]) => {
  console.log('[page]', ...args);
  return '';
});

webview.bind('quit', () => {
  setTimeout(() => webview.destroy(), 50);
  return 'ok';
});

webview.init(`
(function() {
  const log = (...a) => { try { window.logFromPage(...a.map(String)); } catch {} };
  let errCount = 0;
  window.addEventListener('error', e => {
    if (++errCount > 5) return;
    log('window error:', e.message, e.filename + ':' + e.lineno);
  });
  let rejCount = 0;
  window.addEventListener('unhandledrejection', e => {
    if (++rejCount > 5) return;
    log('unhandled rejection:', String(e.reason && e.reason.message || e.reason));
  });

  setTimeout(() => { log('safety quit'); try { window.quit(); } catch {} }, 60000);

  async function waitFor(probe, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = probe();
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  window.addEventListener('load', async () => {
    log('loaded');
    // The graph renders to a <canvas>, so there are no per-node DOM elements to
    // query — read the live cytoscape core the app exposes instead.
    const cy = await waitFor(() => window.__IGNATIUS_CY__);
    if (!cy) {
      log('cytoscape core never appeared');
      await window.quit();
      return;
    }
    await new Promise(r => setTimeout(r, 1500));

    const nodes = cy.nodes().map(n => {
      const p = n.position();
      return { name: n.data('label') || n.id(), x: p.x, y: p.y };
    });

    const report = {
      nodeCount: nodes.length,
      edgeCount: cy.edges().length,
      sample: nodes.slice().sort((a, b) => a.y - b.y).slice(0, 12),
      bounds: {
        minX: Math.min(...nodes.map(n => n.x)),
        maxX: Math.max(...nodes.map(n => n.x)),
        minY: Math.min(...nodes.map(n => n.y)),
        maxY: Math.max(...nodes.map(n => n.y)),
      },
    };
    await window.report(JSON.stringify(report, null, 2));
    await window.quit();
  });
})();
`);

webview.navigate(url);
webview.run();

process.exit(exitCode);
