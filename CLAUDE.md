---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

<atomic-signals>

## Project signals (auto-loaded)


@.claude/project/signals.md

</atomic-signals>


Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.


## Visual changes


When visual changes are made (UI, layout, graph rendering, theming), take Playwright screenshots via the existing harness at `scripts/screenshot.ts` and `test/visual/`. Never claim a visual change works without seeing it. Don't build a new capture path — extend the existing harness instead.


## Feature ↔ documentation ↔ skill map


**Rule: a feature is not done until every surface that covers it is consistent.** When you add or change functionality, update its row below — the design doc (the *why*), the spec (the *contract*), the user guide (the *how*), and the skill section that authors or verifies it. If a change has no row, add one; if it touches a surface not yet listed, add the surface. Drift between these is a reliability bug — the skill teaches one thing, the spec contracts another, the guide documents a third.

Paths are relative to `docs/design/`, `docs/spec/`, `docs/guides/`, and `skills/noorm-modeling/`. This map is the human-facing complement to `.claude/project/signals.md` (which maps domains → source code).

| Feature | Design | Spec | Guide | Skill |
|---------|--------|------|-------|-------|
| Markdown entity / folder format | markdown-driven-erd | — | folder-format | entity-flow E1/E2/E7/E10, templates |
| Classification + cardinality derivation | markdown-driven-erd | derive-classification | derivation | conventions (derivation tables) |
| Two-path convention (key-inherited vs orm) | noorm-modeling-skill | noorm-modeling-skill | derivation, modeling-skill | SKILL core rules, entity-flow E3 + E5 nudge, model-flow M3 |
| Subtype clusters | markdown-driven-erd | derive-classification, schema-lint-and-error-ux | derivation | entity-flow E5a, templates (subtype example) |
| Bidirectional predicates | bidirectional-predicates | bidirectional-predicates | predicates | entity-flow E5 |
| Schema lint + error UX (findings) | schema-lint-and-error-ux | schema-lint-and-error-ux | validation | verification (rule table + loop) |
| CLI subcommands (serve/dict/graph/validate) + static/live outputs | cli-and-outputs | cli-and-outputs | commands, building-from-source, getting-started | verification (runs `ignatius validate`) |
| CLI version + self-update (`version`/`--version`, `update`) | — | — | commands, getting-started | — |
| Project config + model discovery (`ignatius.yml`) | ignatius-project-config | ignatius-project-config | getting-started, folder-format | entity-flow E0, model-flow M1–M8, templates |
| Themes | cli-and-outputs | cli-and-outputs | themes-and-branding | model-flow M4 |
| Branding | branding | branding | themes-and-branding | model-flow M5 |
| Dict navigation + polish | dict-navigation | dict-navigation, dict-polish | — | — |
| Graph viewer FAB UX | viewer-fab-ux | viewer-fab-ux | — | — |
| Business-narrative body + existence/cascade rules | markdown-driven-erd | noorm-modeling-skill | modeling-skill | entity-flow E9, templates (body sections) |
| The modeling skill itself | noorm-modeling-skill | noorm-modeling-skill | modeling-skill | SKILL + all references |
| Example / sample instance tables ⚠ | example-instance-tables | example-instance-tables | — | entity-flow E9 + templates `## Sample rows` |

⚠ **Example instance tables — design and spec authored, implementation pending, surfaces currently diverge.** The spec contracts a structured `examples:` frontmatter array → `ModelNode.examples` → dict/graph accordions + an `example_unknown_column` validator rule. The skill today emits only a prose `## Sample rows` markdown section in the entity body. Reconcile before shipping: either the skill authors `examples:` frontmatter, or the spec adopts the prose form. Until then this row is the canonical record of the gap.
