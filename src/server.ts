import index from './index.html';
import { parseModels } from './parse';
import { resolve } from 'path';

const encoder = new TextEncoder();

/** Active SSE client controllers. Each represents one open /events connection. */
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

/** Broadcast a named SSE event to all connected clients. */
function broadcast(event: string, data: string = '{}') {
  const chunk = encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      // Controller closed — remove it
      sseClients.delete(ctrl);
    }
  }
}

const WATCHED_EXTENSIONS: Record<string, true> = { '.md': true, '.yaml': true };

function hasWatchedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return WATCHED_EXTENSIONS[filename.slice(dot)] === true;
}

export function serveCommand(modelsDir: string, opts: { port?: number } = {}): ReturnType<typeof Bun.serve> {
  const port = opts.port !== undefined ? opts.port : (Number(process.env.PORT) || 3000);

  // Debounce: one global timer — all changes within 200ms coalesce into one event
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const fsWatcher = require('fs').watch(
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
      '/api/model': async () => {
        const model = await parseModels(modelsDir);
        return Response.json(model);
      },
      '/events': (req, server) => {
        // Disable the 10s idle timeout so the SSE stream stays open indefinitely
        server.timeout(req, 0);

        let ctrl: ReadableStreamDefaultController<Uint8Array>;

        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            sseClients.add(ctrl);
            // Flush headers to the client immediately
            ctrl.enqueue(encoder.encode(': connected\n\n'));
          },
          cancel() {
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

  console.log(`derek-db-generator running at http://localhost:${server.port}`);

  // Override stop so we clean up the watcher and active clients
  const origStop = server.stop.bind(server);
  Object.defineProperty(server, 'stop', {
    value: (force?: boolean) => {
      fsWatcher.close();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      sseClients.clear();
      return origStop(force);
    },
    writable: true,
    configurable: true,
  });

  return server;
}

// When invoked directly (bun src/server.ts), default to ./models.
// WHY import.meta.main and not import.meta.path === Bun.main: in a compiled
// Bun binary all bundled modules share the same $bunfs path, making the path
// comparison always true. import.meta.main is only true for the entry module.
if (import.meta.main) {
  const defaultModelsDir = resolve(import.meta.dir, '../models');
  serveCommand(defaultModelsDir);
}
