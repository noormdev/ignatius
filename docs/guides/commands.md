# Commands


ignatius has five subcommands. The three model commands read the same folder format. Two utility commands report and update the installed binary.

| Subcommand | What it does |
|---|---|
| `serve` | Starts an interactive single-page app and watches the folder for changes |
| `export` | Writes a self-contained model file (graph, dictionary, and flows) as one HTML file |
| `validate` | Checks the model and reports findings without writing any output |
| `version` | Prints the installed version |
| `update` | Checks for a newer release and installs it |


## Model discovery


The `[path]` argument is optional for the model commands (`version` and `update` take no path). When omitted, ignatius searches up and down from the current directory for a model root (a folder containing `ignatius.yml`).

- When a path is itself a model root, ignatius uses that model directly.
- When a path contains multiple model roots, ignatius picks one:
    - In a terminal it prompts you with a list.
    - Pass `--model <key>` (the folder name) to choose without the prompt.
    - In a non-interactive shell (CI), an ambiguous run exits with an error and prints the available keys instead of hanging.

The search skips meta and build directories: any path segment starting with `_`, plus `node_modules`, `.git`, `dist`, `tmp`, `trash`, `.worktrees`, and `.claude`.


## serve


Starts a local server with live reload. Editing any `.md` or `.yaml` file in the folder pushes an update to the open browser tab over server-sent events.

```bash
ignatius serve [path] [-p|--port <port>] [--model <key>] [-o|--open]
```

`server` is an accepted alias for `serve`. The port flag takes either `-p` or `--port`; the default is 3000. When the chosen port is already in use, ignatius finds the next free one by counting up (3000 → 3001 → 3002 …). In a terminal it asks which port to use, with that next free port as the default — press enter to accept it or type another. Run non-interactively (a pipe or CI), it advances automatically and prints the port it settled on. Pass `-o` or `--open` to open the app in your default browser once it has bound (it opens the port it actually settled on, even after a fallback).

`serve` renders a single-page app at `/`. The app has three in-app views — **Graph**, **Dictionary**, and **Flows** — switched without a page reload. The active view is reflected in `location.hash` (`#view=graph`, `#view=dict`, `#view=flow`). Back and forward navigation and deep links work.

- **Graph** — the interactive Cytoscape ERD. Click a node to open the rich entity dialog (columns, relationships, examples, findings).
- **Dictionary** — one inline, searchable reference page fusing the entity data dictionary and the flow process dictionary. Every entity, process, external, and data store renders in full; a search box filters live across titles, descriptions, properties, and data types; cross-references are anchor links. No dialogs.
- **Flows** — the DFD viewer (see [Process flows](flows.md)). A `db:` store node opens the same rich entity dialog as a graph node; a process, external, or non-`db` store opens a plain markdown dialog.

While serving, a findings panel lists any schema problems and updates on every save. See [Validation and findings](validation.md).


## export


Generates a self-contained model file with all three views. The output is one HTML file with no external dependencies — open it in any browser or commit it as a shareable artifact.

```bash
ignatius export [path] -o model.html [--theme light|dark] [--model <key>]
```

`-o` is required; omitting it prints an error and exits `1`.

The file includes the Graph, Dictionary, and Flows views with full interactivity: view switching, live Dictionary search, entity dialog, theme toggle, and graph and flow node-position persistence — all offline, from `file://`. The export injects both the entity model and the flow model, so both position-restore keys work without a server.

The exit code merges entity global errors, entity Class-B findings, and flow Class-B findings: exit `0` on a clean model, `1` when any of those are present. Warnings (Class A) alone do not fail the command.

Note: the older `dict`, `graph`, and `flow` subcommands have been removed. Invoking one prints a one-line error pointing to `export`.


## index


Writes a navigable router file into every organizing folder of the model root: the root itself, `groups/`, `data/` and every subdirectory holding entity files, `flows/` and every flow and sub-DFD folder, `externals/`, and `stores/`. Each router is a markdown table of the folder's children with their name, kind, description, and a relative link, so a reader descends the model one small table at a time instead of globbing it. The filename comes from `index_file:` in `ignatius.yml` (default `index.md`).

```bash
ignatius index [path] [--model <key>] [--agents]
```

Every row carries the SHA-256 of its target, and each folder's digest rolls up to the root, so one hash at the top proves the whole tree is current. The generator owns only the bytes inside its own `<ignatius-index>` and `<ignatius-breadcrumb>` tags; prose, headings, and a hand-authored `<ignatius-rules>` block outside them survive regeneration verbatim. Running it twice over an unchanged model is byte-identical.

`--agents` additionally writes three guidance files into the model root: `AGENTS.md` (how to walk the model and its conventions), `SKILL.md` (frontmatter that lets a harness discover the folder as a skill once it is symlinked into `.claude/skills/`), and, when `harness:` resolves to Claude, a `CLAUDE.md` that imports `AGENTS.md`. The guidance carries no entity content, only how to navigate. Which files land is set by `harness:` in `ignatius.yml` (`auto | claude | agents | both`). Nothing is written outside the model root.

Findings print to stderr the same way `export` does, routers are still written, and the exit code is `1` on any Class B finding, `0` otherwise. See [The folder format](folder-format.md) for the router shape and the region contract.


## validate


Checks the model and reports findings without generating any HTML. This is the fast path when you only want to know whether the model is sound: no bundle, no file written.

```bash
ignatius validate [path] [--model <key>] [--index]
```

It prints each finding to stderr in the same format as `export` and writes a one-line summary to stdout, then exits `1` when the model has errors and `0` otherwise. When the model has a `flows/` directory, the flow rules run too and their findings are included. Use it as a lightweight quality gate while authoring or in CI.

`--index` also recomputes every router digest and reports drift as `index.stale`, a Class B finding, so a model whose routers no longer match its files fails the gate. It writes nothing; the fix is `ignatius index`. A plain `validate` never hashes, so the check costs nothing unless asked for.


## version


Prints the version baked into the binary at build time.

```bash
ignatius version
# or
ignatius --version
```

Both print the same value (for example `0.3.0`). Use whichever fits your script.


## update


Checks GitHub for the latest release and, if a newer one exists, offers to replace the running binary in place.

```bash
ignatius update            # check, then prompt before installing
ignatius update --check    # report only; never install
ignatius update --yes      # install without prompting (for scripts)
```

When you are already on the latest version it says so and exits `0`. When a newer version exists it prints the jump (for example `0.3.0 → 0.4.0`) and, unless `--check` is set, downloads the binary for your platform, verifies its checksum against the release `checksums.txt`, and swaps it over the current executable.

Notes:

- The replacement needs write access to the installed binary. If it lives in a system directory such as `/usr/local/bin`, run `sudo ignatius update --yes`, or reinstall with the [install script](getting-started.md#install-script-recommended).
- Outside a terminal (CI) it will not prompt: it reports the available version and exits without installing unless you pass `--yes`.
- Windows binaries cannot replace themselves while running; on Windows the command points you at the release download instead.


## Keyboard shortcuts


The app responds to single-key shortcuts while no text field is focused and no modifier key (Ctrl, Alt, Meta) is held.

| Key | Action |
|-----|--------|
| `g` | Switch to the Data Graph |
| `d` | Switch to the Dictionary |
| `f` | Switch to the Data Flows |
| `l` | Toggle graph layout (organic ↔ hierarchical) — Graph view |
| `b` | Toggle dictionary lens (read ↔ browse) — Dictionary view |
| `/` or `Cmd`/`Ctrl` + `K` | Focus the search bar — Graph, Dictionary, Flows |
| `?` | Open the help overlay for the current view |
| `←` `→` `↑` `↓` | Scroll the canvas 10px — Graph and Flows views; hold `Shift` for 50px |

Shortcuts are ignored while typing in a search box or any other input, and when a modifier key is held. `?` is the one exception to the modifier rule — it needs Shift to type, so Shift does not suppress it (but it is still ignored while typing in a field). `Cmd`/`Ctrl` + `K` is a second exception: like the zoom chords below, it focuses search even while a text field is already focused elsewhere. The arrow keys are a third: `Shift` selects their faster stride instead of suppressing them, and holding an arrow scrolls continuously. Arrows keep their normal meaning while typing in a field, and `Cmd`/`Ctrl`/`Alt` arrow chords are left to the OS and browser.


### Help overlay


Every view has a `?` button in the top bar, next to the light/dark toggle. It opens a short, view-aware overview — what you are looking at, how to explore it, and the keys that work here. The Graph explains entity types and key-inheritance lineage; the Dictionary explains its lenses and spotlight; the Flows view explains DFD symbols and drill-down. Press `?` or click the button; press Escape or click outside to close. For the exact diagram symbols, use the **Legend** instead.


### Zoom


Zoom always acts on the diagram canvas, never the browser page. On both the Data Graph and the Data Flows view:

| Input | Action |
|-------|--------|
| `Cmd`/`Ctrl` + `=` (or `+`) | Zoom in |
| `Cmd`/`Ctrl` + `-` | Zoom out |
| `Cmd`/`Ctrl` + `0` | Fit the diagram to the screen |
| Trackpad pinch | Zoom toward the pointer |

These work even while a text field is focused, since they are not typed characters. The Dictionary view has no canvas, so they do nothing there. Unlike the single-key shortcuts above, the zoom chords require `Cmd`/`Ctrl`; pressing `=`, `-`, or `0` on their own types normally.


## Exit codes


`export`, `validate`, and `index` print any schema findings to stderr and exit `1` when the model has errors (omitted edges, dangling targets, unparseable files, a malformed `index_file`), `0` otherwise. Warnings alone do not fail the command. `validate --index` adds router drift (`index.stale`) to the errors, so running it in CI fails the build when committed routers no longer match the files they describe. See [Validation and findings](validation.md) for the rule catalog.
