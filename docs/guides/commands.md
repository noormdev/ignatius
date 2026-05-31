# Commands


ignatius has three subcommands. All three read the same folder format and respect the same theme.

| Subcommand | What it does |
|---|---|
| `serve` | Starts an interactive server and watches the folder for changes |
| `dict` | Writes a self-contained data dictionary as a single HTML file |
| `graph` | Writes a self-contained interactive graph as a single HTML file |


## Model discovery


The `[path]` argument is optional for all three subcommands. When omitted, ignatius searches up and down from the current directory for a model root (a folder containing `ignatius.yml`).

- When a path is itself a model root, ignatius uses that model directly.
- When a path contains multiple model roots, ignatius picks one:
    - In a terminal it prompts you with a list.
    - Pass `--model <key>` (the folder name) to choose without the prompt.
    - In a non-interactive shell (CI), an ambiguous run exits with an error and prints the available keys instead of hanging.

The search skips meta and build directories: any path segment starting with `_`, plus `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, and `.claude`.


## serve


Starts a local server with live reload. Editing any `.md` or `.yaml` file in the folder pushes an update to the open browser tab over server-sent events.

```bash
ignatius serve [path] [--port <port>] [--model <key>]
```

The default port is 3000. The server also exposes `/dict` (the data dictionary, with `?theme=light|dark`) and `/api/model` (the parsed model plus validation findings as JSON).

While serving, a findings panel in the top-right corner lists any schema problems and updates on every save. See [Validation and findings](validation.md).


## dict


Generates a static data dictionary: every entity with its attribute table, foreign-key links, and rendered documentation, as one HTML file with no external dependencies. Open it in any browser or commit it as a shareable artifact.

```bash
ignatius dict [path] -o dictionary.html [--theme light|dark] [--model <key>]
```


## graph


Generates a static interactive graph. The output embeds the full viewer, so the file is self-contained. The layout runs in the browser when the file opens, then the graph is interactive. Use this to share a diagram with someone who does not have ignatius installed.

```bash
ignatius graph [path] -o graph.html [--theme light|dark] [--model <key>]
```

Both `dict` and `graph` default to the dark theme. Pass `--theme light` for the light palette.


## Exit codes


`dict` and `graph` print any schema findings to stderr and exit `1` when the model has errors (omitted edges, dangling targets, unparseable files), `0` otherwise. Warnings alone do not fail the command. This makes the static commands usable as a CI gate. See [Validation and findings](validation.md) for the rule catalog.
