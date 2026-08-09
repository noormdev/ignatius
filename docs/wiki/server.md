---
type: Domain
description: Bun.serve() HTTP server exposing the model/flow JSON API, SSE live-reload, and the SPA shell behind `ignatius serve`.
---

# server

## What it does

- [`src/server/server.ts`](../../src/server/server.ts) is a single-file domain that exports `serveCommand(modelsDir, opts)`, which starts a `Bun.serve()` instance serving the ignatius SPA and its JSON/SSE endpoints for a given model directory.
- It watches `modelsDir` for `.md`/`.yaml` changes with `fs.watch` and pushes a debounced SSE event so an open browser tab can hot-reload the model.
- It has no internal test directory — it is exercised by files under [`test/checks/`](../../test/checks).

## CLI code

- [`src/server/server.ts`](../../src/server/server.ts) — exports `serveCommand(modelsDir: string, opts: { port?: number } = {}): ServeHandle`, where `ServeHandle = { server: ReturnType<typeof Bun.serve>; stop: (force?: boolean) => void }`. Port defaults to `Number(process.env.PORT) || 3000`. Routes are registered via `Bun.serve`'s native `routes` map, not a router library:
  - `GET /` → [`src/app/index.html`](../../src/app/index.html) bound directly as a Bun HTML import (the SPA shell)
  - `GET /dict` → 302 redirect to `/#view=dict`
  - `GET /flow` → 302 redirect to `/#view=flow`
  - `GET /flow-dict` → 302 redirect to `/#view=dict` — comment marks this CP5, the process dictionary having been fused into the SPA Dictionary view
  - `GET /api/model` → runs `parseModels(modelsDir)` then `validateModel(model)` then `layoutFingerprint(model)`; returns JSON `{ model, parseGlobalErrors, validation, layoutKey }` where `validation: ValidationResult = { entityErrors, globalErrors, cleanedModel }` ([`src/model/validate.ts`](../../src/model/validate.ts))
  - `GET /api/flow` → guards on `existsSync(join(modelsDir, 'flows'))`; if absent, returns 200 with an empty-state payload `{ diagrams: [], validation: { flowErrors: [], globalErrors: [], cleanedFlowModel: { diagrams: [], modelDir } }, flowLayoutKeys: {} }` — this shape has no `entityModel` key. If present, runs `parseModels`, `parseFlows(modelsDir)`, `validateFlows(flowModel, model, model._meta?.flowRules ?? {})`, `buildFlowLayoutKeys(flowModel)`; returns `{ diagrams: flowModel.diagrams, entityModel: model, validation, flowLayoutKeys }` — `entityModel` travels with the payload so the flow viewer can resolve `db:` store docs to their ERD entity narrative
  - `GET /api/asset?path=` → resolves `path` under `modelsDir`; rejects absolute paths and `normalize(path)` starting with [`..`](../../..) (400) before calling `resolve()`; 404 if the resolved file doesn't exist; otherwise streams the `Bun.file`
  - `GET /events` → SSE stream; calls `server.timeout(req, 0)` to disable Bun's default idle timeout; adds the stream's controller to a per-instance `sseClients` Set on `start`, removes it on `cancel`; writes a `: connected\n\n` comment line immediately on open
- `fs.watch(modelsDir, { recursive: true }, ...)` — created inside `serveCommand`; `hasWatchedExtension()` filters events to `.md`/`.yaml` filenames only; a single per-instance `debounceTimer` coalesces events over 200ms before calling `broadcast('model-changed')`
- `broadcast(event, data = '{}')` — internal helper; encodes an SSE frame (`event: ...\ndata: ...\n\n`) and enqueues it to every controller in `sseClients`; a controller whose `enqueue` throws (closed connection) is deleted from the set during iteration
- `stop(force?)` (the second field of `ServeHandle`) — closes the fs watcher, clears the debounce timer, clears `sseClients`, calls `server.stop(force)`
- Direct-invocation entry point: `if (import.meta.main)` defaults `modelsDir` to `../../models` relative to the file and calls `serveCommand`. Guarded by `import.meta.main` rather than an `import.meta.path === Bun.main` comparison — a comment explains that in a compiled Bun binary every bundled module shares the same `$bunfs` path, which would make that comparison always true

## Coupling

- Imports `parseModels` from [`src/model/parse.ts`](../../src/model/parse.ts) and `validateModel` from [`src/model/validate.ts`](../../src/model/validate.ts) (parser / validate domains) for `/api/model`; a shape change to `Model`, `ParseResult`, or `ValidationResult` forces a matching change in the `/api/model` JSON contract here, and downstream in any frontend code consuming it.
- Imports `layoutFingerprint` from [`src/model/layout-fingerprint.ts`](../../src/model/layout-fingerprint.ts) (parser domain) for the `layoutKey` field.
- Imports `parseFlows` ([`src/flows/flow-parse.ts`](../../src/flows/flow-parse.ts)), `validateFlows` ([`src/flows/flow-validate.ts`](../../src/flows/flow-validate.ts)), `buildFlowLayoutKeys` ([`src/flows/flow-fingerprint.ts`](../../src/flows/flow-fingerprint.ts)) — all flows domain — for `/api/flow`; also reads `model._meta?.flowRules` (populated from `flow_rules:` in `ignatius.yml` by the parser) as the config passed into `validateFlows`.
- Imports [`src/app/index.html`](../../src/app/index.html) (frontend domain) as a Bun HTML import bound directly to the [`/`](../..) route — a frontend build change is picked up through Bun's bundling of that HTML import, no separate wiring in this file.
- Depended on by [`src/cli/serve-port.ts`](../../src/cli/serve-port.ts) (cli domain): `serveWithPortFallback()` wraps `serveCommand` in an EADDRINUSE retry/prompt loop for the `serve` CLI command; a change to how `serveCommand` throws on a bound port would break that fallback logic.
- [`scripts/perf-harness.ts`](../../scripts/perf-harness.ts) (scripts domain) spawns `bun src/cli/cli.ts serve <modelDir> --port <port>` as a subprocess to benchmark a running server — coupled through the cli command, not a direct import of this file.
- `test/checks/*.ts` (e.g. `test-api-model.ts`, `test-asset-route.ts`, `test-sse-live-reload.ts`, `test-flow-serve.ts`, `test-mode-flag.ts`, `test-cp4e-elk-renders-in-browser.ts`, `test-dfd-edge-hover.ts`, `test-graph-search.ts`) import `serveCommand` directly to boot a real server for integration checks.

## Conventions worth knowing

- Single-file domain: all server logic lives in [`src/server/server.ts`](../../src/server/server.ts); there is no subdirectory structure under [`src/server/`](../../src/server).
- Routes are registered through `Bun.serve`'s native `routes` object (a path-to-handler/static-import map), not a router library — consistent with the "no Express" steering.
- SSE client tracking uses a per-server-instance `Set<ReadableStreamDefaultController>`; `broadcast()` self-heals by deleting a controller the moment its `enqueue` throws, rather than tracking connection state separately.
- `/events` explicitly disables Bun's idle timeout via `server.timeout(req, 0)` so a long-lived SSE stream isn't killed after 10s.
- The `/api/flow` empty-state response (no `flows/` directory) omits `entityModel`, while the populated response includes it — callers must branch on the presence of that key rather than assuming a fixed shape.
- `development: { hmr: true, console: true }` is passed to `Bun.serve` unconditionally, not gated on an environment check.
- Route handler comments use checkpoint labels (e.g. "CP5") to reference the design step that produced a given behavior.
