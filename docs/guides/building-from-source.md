# Building from source


ignatius is built with [Bun](https://bun.com). `bun build --compile` produces a single executable named `ignatius` with the Bun runtime, the CLI, and the React viewer bundled in. It runs on its own with no install step.

```bash
git clone https://github.com/noormdev/ignatius.git
cd ignatius
bun install
bun run build:cli
```

That runs three stages in order:

1. **Bundle** the React app (`build:bundle`).
2. **Rename** the hashed output files to stable names so they can be embedded (`build:stable-names`).
3. **Compile** `src/cli/cli.ts` into `dist/ignatius`.

The `serve` and `validate` subcommands work without a prior bundle build. `export` needs the embedded bundle, so build it first if you only ran `build:bundle`.


## Project layout


| Path | Contents |
|---|---|
| `src/cli/cli.ts` | Argument parsing and subcommand dispatch (built on citty) |
| `src/cli/discover.ts` | Pure model-root resolver for the `[path]` discovery rules |
| `src/server/server.ts` | The `serve` server with live reload over SSE |
| `src/model/parse.ts` | Reads the folder, parses frontmatter, derives the model |
| `src/model/validate.ts` | Pure linter: rules, severities, and the cleaned model |
| `src/app/App.tsx` | The React SPA: Graph, Dictionary, and Flows views; findings panel; theme toggle |
| `src/generators/` | Static output for `export` |
| `models/` | Reference schemas used as the default folder |
| `docs/design/` | Design documents for the format and the CLI |
| `docs/spec/` | Implementation contracts derived from the designs |

The stack is Bun, React 19, Cytoscape.js with the ELK layered layout, `markdown-it` for prose, and `yaml` for frontmatter. The crow's-foot cardinality markers are a custom SVG overlay drawn on top of the graph.


## Tests


The check suite is a set of raw assertion scripts under `test/checks/`, run in order:

```bash
bun run test
```

Run a single check directly with `bun test/checks/test-<name>.ts`. Visual scripts under `test/visual/` are Playwright screenshot helpers for manual inspection and are not part of `bun run test`. See `CONTRIBUTING.md` for the contribution workflow.
