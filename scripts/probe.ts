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

  async function waitFor(selector, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  window.addEventListener('load', async () => {
    log('loaded');
    const node = await waitFor('.react-flow__node');
    if (!node) {
      log('no nodes appeared');
      await window.quit();
      return;
    }
    await new Promise(r => setTimeout(r, 1500));

    const nodes = [...document.querySelectorAll('.react-flow__node')].map(el => {
      const t = el.style.transform || '';
      const m = t.match(/translate\\(([-0-9.]+)px[, ]+([-0-9.]+)px\\)/);
      const name = el.querySelector('.entity-node .header > span')?.textContent || '?';
      return { name, x: m ? +m[1] : null, y: m ? +m[2] : null };
    });

    const edges = [...document.querySelectorAll('.react-flow__edge')].length;

    const report = {
      nodeCount: nodes.length,
      edgeCount: edges,
      sample: nodes.slice().sort((a,b) => (a.y||0) - (b.y||0)).slice(0, 12),
      bounds: {
        minX: Math.min(...nodes.map(n => n.x ?? Infinity)),
        maxX: Math.max(...nodes.map(n => n.x ?? -Infinity)),
        minY: Math.min(...nodes.map(n => n.y ?? Infinity)),
        maxY: Math.max(...nodes.map(n => n.y ?? -Infinity)),
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
