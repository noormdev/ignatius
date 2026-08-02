---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

<atomic-signals>

## Project signals (auto-loaded)


@docs/wiki/index.md

</atomic-signals>


Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
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

## Visual changes


When visual changes are made (UI, layout, graph rendering, theming), take screenshots via the existing harness — `test/visual/` for Playwright captures, `scripts/screenshot.ts` for a quick webview-bun grab. Never claim a visual change works without seeing it. Don't build a new capture path — extend the existing harness instead.


## Surface consistency


A feature is not done until every surface that covers it is consistent — the design doc (the *why*), the spec (the *contract*), the user guide (the *how*), and the skill section that authors or verifies it. Drift between them is a reliability bug: the skill teaches one thing, the spec contracts another, the guide documents a third. The per-feature map of those surfaces lives in `docs/wiki/feature-map.md` — read it when you change functionality, and add a row if the feature has none.


## Blocked work


When something blocks a request — a permission this session lacks, an action reserved for the human — say so once, in one sentence, together with the command that unblocks it. On later turns repeat the workaround, never the explanation. **Why:** restating a fixed limit reads as stalling and spends the turn the user wanted spent on getting unblocked.
