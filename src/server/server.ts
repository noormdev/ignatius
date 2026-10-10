import index from '../app/index.html';
import { parseModels } from '../model/parse';
import { validateModel } from '../model/validate';
import { layoutFingerprint } from '../model/layout-fingerprint';
import { parseFlows } from '../flows/flow-parse';
import { validateFlows } from '../flows/flow-validate';
import { buildFlowLayoutKeys } from '../flows/flow-fingerprint';
import { approve, baselinePath, buildReview, ensureBaseline } from '../model/change-store';
import { resolve, normalize, isAbsolute, join } from 'path';
import { watch, watchFile, unwatchFile, existsSync, type Stats } from 'fs';

const encoder = new TextEncoder();

// `.yml` matters as much as `.yaml`: the model marker is `ignatius.yml`, so
// without it an edit to name, theme, branding or flow_rules never reloaded.
const WATCHED_EXTENSIONS: Record<string, true> = { '.md': true, '.yaml': true, '.yml': true };

function hasWatchedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return WATCHED_EXTENSIONS[filename.slice(dot)] === true;
}

// A DNS-rebound page reaches the server under its own domain name, where every
// request looks same-origin; only a name that cannot be rebound proves locality.
function isLocalHost(req: Request): boolean {
  const host = req.headers.get('host');
  if (host === null) return false;
  try {
    const { hostname } = new URL(`http://${host}`);
    return hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
  } catch {
    return false;
  }
}

// The server listens on every interface and a bodyless POST is a CORS simple
// request, so any page the user visits could otherwise trigger a state change.
function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
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
  const baselineFile = baselinePath(modelsDir);

  function scheduleModelChanged() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      broadcast('model-changed');
    }, 200);
  }

  const fsWatcher = watch(
    modelsDir,
    { recursive: true },
    (_eventType: string, filename: string | null) => {
      if (!filename) return;
      // Ignore directory-only events (no extension) and non-watched extensions
      if (!hasWatchedExtension(filename)) return;
      scheduleModelChanged();
    }
  );

  const server = Bun.serve({
    port,
    routes: {
      '/': index,
      '/dict': () => Response.redirect('/#view=dict', 302),
      '/api/model': async () => {
        const { model, globalErrors: parseGlobalErrors } = await parseModels(modelsDir);
        const validation = validateModel(model);
        const layoutKey = layoutFingerprint(model);
        const diff = await buildReview(modelsDir, model).catch((err: unknown) => {
          console.error(`ignatius: could not build the change review: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        return Response.json({ model, parseGlobalErrors, validation, layoutKey, diff });
      },
      '/api/approve': async (req: Request) => {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
        }
        if (!isSameOrigin(req) || !isLocalHost(req)) return new Response('Forbidden', { status: 403 });
        const counts = await approve(modelsDir);
        broadcast('model-changed');
        return Response.json(counts);
      },
      '/flow': () => Response.redirect('/#view=flow', 302),
      '/api/flow': async () => {
        // Guard: if no flows/ directory, return an empty-state payload (200), not 500.
        const flowsDir = join(modelsDir, 'flows');
        const hasFlows = existsSync(flowsDir);
        if (!hasFlows) {
          // entityModel is present here too — the empty state must not be a
          // different SHAPE from the populated one, or a consumer that reads
          // `entityModel` breaks only on models that happen to have no flows.
          const { model: entityModel } = await parseModels(modelsDir);
          return Response.json({ diagrams: [], entityModel, validation: { flowErrors: [], globalErrors: [], cleanedFlowModel: { diagrams: [], modelDir: modelsDir } }, flowLayoutKeys: {}, clusters: [] });
        }

        const { model } = await parseModels(modelsDir);
        const { flowModel } = await parseFlows(modelsDir);
        const flowRulesConfig = model._meta?.flowRules ?? {};
        const validation = validateFlows(flowModel, model, flowRulesConfig);
        const flowLayoutKeys = buildFlowLayoutKeys(flowModel);
        // entityModel travels with the payload so the flow viewer's doc dialog can
        // resolve `db:` store docs to their ERD entity narrative (and hot-reload
        // them on edit). Static mode injects window.__MODEL__ instead.
        return Response.json({ diagrams: flowModel.diagrams, entityModel: model, validation, flowLayoutKeys, clusters: flowModel.clusters });
      },
      '/flow-dict': () => {
        // CP5: the process dictionary is now fused into the SPA Dictionary view.
        // Redirect to the unified app at /#view=dict.
        return new Response(null, {
          status: 302,
          headers: { Location: '/#view=dict' },
        });
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

  let stopped = false;
  const onBaselineStat = (current: Stats, previous: Stats) => {
    if (current.mtimeMs !== previous.mtimeMs) scheduleModelChanged();
  };

  ensureBaseline(modelsDir).catch((err: unknown) => {
    console.error(`ignatius: could not prepare the change-review baseline: ${err instanceof Error ? err.message : String(err)}`);
  }).finally(() => {
    // A CLI approve that clears no notes writes only the baseline, which the recursive watcher ignores (model
    // extensions only; matching it there proved unreliable on macOS). Polling starts after serve's first write.
    if (!stopped) watchFile(baselineFile, { interval: 500 }, onBaselineStat);
  });

  function stop(force?: boolean) {
    stopped = true;
    unwatchFile(baselineFile, onBaselineStat);
    fsWatcher.close();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    sseClients.clear();
    server.stop(force);
  }

  return { server, stop };
}

// When invoked directly (bun src/server/server.ts), default to ./models.
// WHY import.meta.main and not import.meta.path === Bun.main: in a compiled
// Bun binary all bundled modules share the same $bunfs path, making the path
// comparison always true. import.meta.main is only true for the entry module.
if (import.meta.main) {
  const defaultModelsDir = resolve(import.meta.dir, '../../models');
  // Destructure — we only need the server handle; stop is available if tests call it
  const { server } = serveCommand(defaultModelsDir);
  void server; // satisfy linter — server stays alive via event loop
}
