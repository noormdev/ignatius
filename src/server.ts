import index from './index.html';
import { parseModels } from './parse';
import { resolve } from 'path';

const modelsDir = resolve(import.meta.dir, '../models');
const port = Number(process.env.PORT) || 3000;

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
