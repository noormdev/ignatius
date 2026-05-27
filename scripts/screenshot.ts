// Snapshot every <svg> on the catalog page to a file.
// One bind call carries the full payload; sync writeFileSync inside the bind
// avoids webview-bun's IPC deadlock that affects awaited writes. The bind
// handler destroys the webview itself, so there are no safety timers or
// page-side quit dance.

import { Webview, SizeHint } from 'webview-bun';
import { writeFileSync, mkdirSync } from 'node:fs';

const url    = process.argv[2] || 'http://localhost:3777';
const outDir = process.argv[3] || '/tmp/derek-shots';
mkdirSync(outDir, { recursive: true });

const webview = new Webview(false, { width: 1400, height: 900, hint: SizeHint.FIXED });
webview.title = 'derek-snapshot';

let wrote = 0;

webview.bind('logFromPage', (...args: unknown[]) => {
  console.log('[page]', ...args);
  return '';
});

webview.bind('writeSnapshots', (json: string) => {
  const items = JSON.parse(json) as Array<{ filename: string; contents: string }>;
  console.log(`[bun] received ${items.length} snapshots`);
  for (const it of items) {
    const safe = it.filename.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
    const path = `${outDir}/${safe}`;
    writeFileSync(path, it.contents);
    wrote++;
  }
  console.log(`[bun] wrote ${wrote} file(s) to ${outDir}`);
  // close the window — this lets webview.run() return.
  setTimeout(() => webview.destroy(), 50);
  return 'ok';
});

webview.init(`
(function() {
  const log = (...a) => { try { window.logFromPage(...a.map(String)); } catch {} };
  window.addEventListener('load', async () => {
    try {
      const start = Date.now();
      while (!document.querySelector('.card svg') && Date.now() - start < 8000) {
        await new Promise(r => setTimeout(r, 80));
      }
      const cards = document.querySelectorAll('.card');
      const serializer = new XMLSerializer();
      const items = [];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const title = (card.querySelector('h3')?.textContent || 'untitled').trim();
        const svg = card.querySelector('svg');
        if (!svg) continue;
        const inner = serializer.serializeToString(svg);
        const viewBox = svg.getAttribute('viewBox') || '';
        const wrapped =
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '">' +
          '<rect x="0" y="0" width="100%" height="100%" fill="#0e1116"/>' +
          inner.replace(/^<svg[^>]*>/, '').replace(/<\\/svg>$/, '') +
          '</svg>';
        items.push({
          filename: (i + 1).toString().padStart(2, '0') + '-' + title + '.svg',
          contents: wrapped,
        });
      }
      log('collected ' + items.length + ' card svg(s)');
      await window.writeSnapshots(JSON.stringify(items));
    } catch (e) {
      log('error:', String(e && e.message || e));
    }
  });
})();
`);

const t0 = Date.now();
webview.navigate(url);
webview.run();
console.log(`done in ${Date.now() - t0}ms — ${wrote} file(s)`);
process.exit(wrote > 0 ? 0 : 1);
