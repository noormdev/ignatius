# Commands


ignatius has seven subcommands. The five model commands read the same folder format. Two utility commands report and update the installed binary.

| Subcommand | What it does |
|---|---|
| `serve` | Starts an interactive single-page app and watches the folder for changes |
| `export` | Writes a self-contained model file (graph, dictionary, and flows) as one HTML file |
| `validate` | Checks the model and reports findings without writing any output |
| `index` | Writes a navigable router file into every organizing folder |
| `approve` | Accepts the current model as the change-review baseline and deletes the change notes |
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

`serve` also diffs the model against the last approved state and marks what changed in all three views, with a Changes panel that lists each change beside the note that explains it. See [Change review](change-review.md).


### Settings


The FAB menu (the round button, bottom right) has a **Settings** item in every view, in `serve` and in an exported file. It opens a dialog of viewer preferences, saved in the browser's localStorage under `ignatius-settings` so they survive a reload.

| Setting | Default | Effect |
|---|---|---|
| Always open examples | off | Opens every example table, in the Dictionary, the entity dialog, and process dialogs. Off, a table opens only when it has 3 rows or fewer. |


### Dictionary sidebar


The Dictionary's contents sidebar opens from the **Sidebar** tab on the right edge of the screen or from the FAB's **Toggle sidebar** item. The browser remembers whether it was open, so a reload keeps it that way. The tab sits half off-screen until you hover or focus it, and it disappears while the sidebar is open. The close button at the top of the sidebar closes it and brings the tab back. Like the sidebar itself, the tab is hidden on screens 768px wide or narrower and in print.

The Dictionary and its sidebar each keep their scroll position, per browser tab, through a model reload after a save, a switch to another view and back, and a page refresh. Opening a process from an entity dialog still scrolls to that process.


### Export HTML


The FAB's **Export HTML** item downloads the model as one HTML file, as you see it now. It appears in every view while serving, and not in an exported file, because it needs the server. The file is the same as `ignatius export` produces, plus your view state, and is named after the model (`key-inherited.html` for a model named "Key-Inherited").

What travels with the file:

- Your graph and flow arrangements for this model: node positions and hidden entities. Arrangements of other models served from the same address stay out.
- Your preferences: theme, graph layout mode, minimap, Dictionary lens, sidebar open state, flow view and collapse level, and Settings.
- The URL hash, so the file opens on the view, diagram, or entity you had open.

Scroll positions do not travel. On a failure, the server's error message shows beside the FAB.

The view state applies once, the first time a browser opens that export. It replaces the recipient's preferences, including clearing ones the export did not carry, and merges the arrangements in beside any other models the recipient has opened. The hash is set only when the URL has none. Reloading the same file afterwards keeps whatever the recipient changed since; a new export with different state applies again.


## export


Generates a self-contained model file with all three views. The output is one HTML file with no external dependencies — open it in any browser or commit it as a shareable artifact.

```bash
ignatius export [path] -o model.html [--theme light|dark] [--model <key>]
```

`-o` is required; omitting it prints an error and exits `1`.

To export what you see in `serve`, with your arrangement, hidden entities, and preferences, use the FAB's [Export HTML](#export-html) item instead.

The file includes the Graph, Dictionary, and Flows views with full interactivity: view switching, live Dictionary search, entity dialog, theme toggle, and graph and flow node-position persistence — all offline, from `file://`. The export injects both the entity model and the flow model, so both position-restore keys work without a server.

When the model has an approved baseline (see [Change review](change-review.md)), the export also carries the change review: the same glows, ghost nodes, and Changes panel as a served model, without the Approve button. A model with no baseline exports no review, and export never creates one. The export carries the pending changes and their note text, so run `ignatius approve` first when you want a clean shareable file.

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


## approve


Accepts the current model as the baseline that `serve` diffs against, and deletes every file in `.ignatius/changes/`.

```bash
ignatius approve [path] [--model <key>]
```

It resolves the model with the same discovery rules as the other model commands, then prints what it accepted and exits `0`:

```
Approved 3 change(s), cleared 1 note(s).
```

A model with no baseline yet gets one, and reports `0` changes. The Approve button in the `serve` Changes panel does the same thing. See [Change review](change-review.md).


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
- While the binary downloads, a single line updates in place: `Downloading 41.9 / 73.2 MB (57%)`, ending with `Downloaded 73.2 MB (100%)` before the swap. Off a terminal (CI, piped output) this line is suppressed and one static line prints instead. If the server does not report a size, it shows the megabytes downloaded so far with no percentage.


## Keyboard shortcuts


The app responds to single-key shortcuts while no text field is focused and no modifier key (Ctrl, Alt, Meta) is held.

| Key | Action |
|-----|--------|
| `g` | Switch to the Data Graph |
| `d` | Switch to the Dictionary |
| `f` | Switch to the Data Flows |
| `l` | Step through graph layouts (organic → hierarchical → tree; a first visit opens in tree) — Graph view |
| `s` | Toggle select mode: a plain drag draws a selection box, a click adds or removes — Graph view |
| `h` | Hide the selected entities — Graph view |
| `Cmd`/`Ctrl` + `Z` | Undo the last move, hide, or layout change — Graph view |
| `Cmd`/`Ctrl` + `Shift` + `Z`, `Ctrl` + `Y` | Redo it — Graph view |
| `b` | Toggle dictionary lens (read ↔ browse) — Dictionary view |
| `i` | Open or close the flow index — Flows view |
| `/` or `Cmd`/`Ctrl` + `K` | Focus the search bar — Graph, Dictionary, Flows |
| `?` | Open the help overlay for the current view |
| `←` `→` `↑` `↓` | Scroll the canvas 10px — Graph and Flows views; hold `Shift` for 50px |

Shortcuts are ignored while typing in a search box or any other input, and when a modifier key is held. `?` is the one exception to the modifier rule — it needs Shift to type, so Shift does not suppress it (but it is still ignored while typing in a field). `Cmd`/`Ctrl` + `K` is a second exception: like the zoom chords below, it focuses search even while a text field is already focused elsewhere. The arrow keys are a third: `Shift` selects their faster stride instead of suppressing them, and holding an arrow scrolls continuously. Arrows keep their normal meaning while typing in a field, and `Cmd`/`Ctrl`/`Alt` arrow chords are left to the OS and browser. The undo and redo chords act on the Graph only while no field is focused; in a field they undo the text.


### Help overlay


Every view has a `?` button in the top bar, next to the light/dark toggle. It opens a short, view-aware overview — what you are looking at, how to explore it, and the keys that work here. The Graph explains entity types and key-inheritance lineage; the Dictionary explains its lenses and spotlight; the Flows view explains DFD symbols, drill-down, the flow index, and the breadcrumb level menus. Press `?` or click the button; press Escape or click outside to close. For the exact diagram symbols, use the **Legend** instead.


### Dialogs


Every dialog (entity, process, groups, legend, help, settings) keeps keyboard focus inside itself while it is open. Opening one focuses its close button. `Tab` and `Shift` + `Tab` cycle through the dialog's controls and wrap at either end, and focus that lands behind the dialog moves back into it. Escape closes the dialog and returns focus to the control that opened it. When one dialog opens another, such as a JSON value expanded from an entity dialog, only the top one responds to Tab and Escape.


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
