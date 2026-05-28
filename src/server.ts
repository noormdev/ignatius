import index from './index.html';
import { parseModels } from './parse';
import { resolve } from 'path';

export function serveCommand(modelsDir: string, opts: { port?: number } = {}): ReturnType<typeof Bun.serve> {
  const port = opts.port !== undefined ? opts.port : (Number(process.env.PORT) || 3000);

  const server = Bun.serve({
    port,
    routes: {
      '/': index,
      '/api/model': async () => {
        const model = await parseModels(modelsDir);
        return Response.json(model);
      },
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`derek-db-generator running at http://localhost:${server.port}`);
  return server;
}

// When invoked directly (bun src/server.ts), default to ./models
if (import.meta.path === Bun.main) {
  const defaultModelsDir = resolve(import.meta.dir, '../models');
  serveCommand(defaultModelsDir);
}
