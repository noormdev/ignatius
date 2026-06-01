import index from './index.html';
import { parseModels } from './parse';
import { validateModel } from './validate';
import { generateDict } from './generators/dict';
import { layoutFingerprint } from './layout-fingerprint';
import { resolve, normalize, isAbsolute } from 'path';
import { watch } from 'fs';

const encoder = new TextEncoder();

const WATCHED_EXTENSIONS: Record<string, true> = { '.md': true, '.yaml': true };

function hasWatchedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return WATCHED_EXTENSIONS[filename.slice(dot)] === true;
}

export type ServeHandle = {
  server: ReturnType<typeof Bun.serve>;
  stop: (force?: boolean) => void;
};

export function serveCommand(modelsDir: string, opts: { port?: number } = {}): ServeHandle {
  const port = opts.port !== undefined ? opts.port : (Number(process.env.PORT) || 3000);

  /** Active SSE client controllers. One set per server instance. */
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  /** Broadcast a named SSE event to all connected clients. */
  function broadcast(event: string, data: string = '{}') {
    const chunk = encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
    // Set deletion during iteration is spec-safe per ECMAScript.
    for (const ctrl of sseClients) {
      try {
        ctrl.enqueue(chunk);
      } catch {
        // Controller closed — remove it
        sseClients.delete(ctrl);
      }
    }
  }

  // Debounce: one timer per server instance — all changes within 200ms coalesce into one event
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const fsWatcher = watch(
    modelsDir,
    { recursive: true },
    (_eventType: string, filename: string | null) => {
      if (!filename) return;
      // Ignore directory-only events (no extension) and non-watched extensions
      if (!hasWatchedExtension(filename)) return;

      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        broadcast('model-changed');
      }, 200);
    }
  );

  const server = Bun.serve({
    port,
    routes: {
      '/': index,
      '/dict': async (req) => {
        const url = new URL(req.url);
        const rawTheme = url.searchParams.get('theme');
        const mode = rawTheme === 'light' ? 'light' : 'dark';
        const { model, globalErrors: parseGlobalErrors } = await parseModels(modelsDir);
        const validation = validateModel(model);
        const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];
        const renderModel = { ...model, nodes: validation.cleanedModel.nodes };
        const html = await generateDict(renderModel, { globalErrors: allGlobalErrors, entityErrors: validation.entityErrors }, mode, { modelsDir, graphHref: '/', surface: 'live' });
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
      '/api/model': async () => {
        const { model, globalErrors: parseGlobalErrors } = await parseModels(modelsDir);
        const validation = validateModel(model);
        const layoutKey = layoutFingerprint(model);
        return Response.json({ model, parseGlobalErrors, validation, layoutKey });
      },
      '/api/asset': async (req) => {
        const url = new URL(req.url);
        const rawPath = url.searchParams.get('path');
        if (!rawPath) {
          return new Response('Missing path query parameter', { status: 400 });
        }
        // Reject absolute paths and traversal segments
        if (isAbsolute(rawPath) || normalize(rawPath).startsWith('..')) {
          return new Response('Path not allowed', { status: 400 });
        }
        const resolved = resolve(modelsDir, rawPath);
        const file = Bun.file(resolved);
        if (!(await file.exists())) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(file, { status: 200 });
      },
      '/events': (req, server) => {
        // Disable the 10s idle timeout so the SSE stream stays open indefinitely
        server.timeout(req, 0);

        let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            sseClients.add(ctrl);
            // Flush headers to the client immediately
            ctrl.enqueue(encoder.encode(': connected\n\n'));
          },
          cancel() {
            if (!ctrl) return;
            sseClients.delete(ctrl);
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      },
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`ignatius serving at http://localhost:${server.port}`);

  function stop(force?: boolean) {
    fsWatcher.close();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    sseClients.clear();
    server.stop(force);
  }

  return { server, stop };
}

// When invoked directly (bun src/server.ts), default to ./models.
// WHY import.meta.main and not import.meta.path === Bun.main: in a compiled
// Bun binary all bundled modules share the same $bunfs path, making the path
// comparison always true. import.meta.main is only true for the entry module.
if (import.meta.main) {
  const defaultModelsDir = resolve(import.meta.dir, '../models');
  // Destructure — we only need the server handle; stop is available if tests call it
  const { server } = serveCommand(defaultModelsDir);
  void server; // satisfy linter — server stays alive via event loop
}
