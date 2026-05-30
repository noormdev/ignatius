# ignatius


ignatius turns a folder of markdown files into an interactive IDEF1X entity-relationship diagram. Each entity lives in its own `.md` file with YAML frontmatter for structure and a prose body for documentation. The tool reads that folder, derives the relationships, and renders a graph you can pan, zoom, and click through. Markdown is the source of truth. The diagram is generated, never hand-drawn.

You write the schema as text. ignatius works out the cardinality, the entity classification, and the subtype clusters from the structure you describe, then draws the crow's-foot notation for you.


## Why markdown


A diagram drawn by hand drifts from the schema it documents. ignatius removes the drawing step. You describe entities, primary keys, columns, and relationships in frontmatter, and the layout follows from the data. Change a foreign key and the cardinality marker updates on the next reload. Add an entity file and it appears in the graph. The text diffs cleanly in version control, so a schema change reads like any other code change.


## Install


### Download a release (recommended)

Pick the binary for your platform from the [latest GitHub release](https://github.com/<owner>/<repo>/releases/latest) and put it on your `$PATH`:

```bash
# macOS arm64
curl -L -o ignatius https://github.com/<owner>/<repo>/releases/latest/download/ignatius-darwin-arm64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/

# Linux x64
curl -L -o ignatius https://github.com/<owner>/<repo>/releases/latest/download/ignatius-linux-x64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/
```

Verify with `ignatius --help`. The binary is self-contained; it has no runtime dependency and works on machines without Bun installed.

Releases include `checksums.txt` if you want to verify the download with `shasum -a 256 -c`.

### From source

ignatius is built with [Bun](https://bun.com). Install Bun first, then:

```bash
bun install
bun run build:cli
```

That produces `./dist/ignatius`.


## Quick start


Point the dev CLI at the bundled reference schema and open the page it serves:

```bash
bun run dev:cli
```

That serves the `models/` reference schema (three variants of the same data model: `key-inherited`, `orm-hybrid`, `orm-pure`) at `http://localhost:3000`. Edit any file under `models/` and the graph reloads in the browser without a refresh.

To run against your own folder, call the CLI directly with the `serve` subcommand:

```bash
ignatius serve path/to/your/models --port 3000
```

If the path contains multiple model folders, ignatius lists them and prompts you to pick one. Pass `--model <key>` to skip the prompt.


## Commands


ignatius has three subcommands. All three read the same folder format and respect the same theme.

| Subcommand | What it does |
|---|---|
| `serve` | Starts an interactive server and watches the folder for changes |
| `dict` | Writes a self-contained data dictionary as a single HTML file |
| `graph` | Writes a self-contained interactive graph as a single HTML file |

The `[path]` argument is optional for all three subcommands. When omitted, ignatius searches up and down from the current directory for a model root (a folder containing `ignatius.yml`). When a path is a model root it uses that model directly. When a path contains multiple model roots, ignatius picks one:

- In a terminal it prompts you with a list.
- Pass `--model <key>` (the folder name) to choose without the prompt.
- In a non-interactive shell (CI), an ambiguous run exits with an error and prints the available keys instead of hanging.

### serve


Starts a local server with live reload. Editing any `.md` or `.yaml` file in the folder pushes an update to the open browser tab.

```bash
ignatius serve [path] [--port <port>] [--model <key>]
```

The default port is 3000.

### dict


Generates a static data dictionary: every entity with its attribute table, foreign-key links, and rendered documentation, as one HTML file with no external dependencies. Open it in any browser or commit it as a shareable artifact.

```bash
ignatius dict [path] -o dictionary.html [--theme light|dark] [--model <key>]
```

### graph


Generates a static interactive graph. The output embeds the full viewer, so the file is self-contained. The layout runs in the browser when the file opens, then the graph is interactive. Use this to share a diagram with someone who does not have ignatius installed.

```bash
ignatius graph [path] -o graph.html [--theme light|dark] [--model <key>]
```

Both `dict` and `graph` default to the dark theme. Pass `--theme light` for the light palette.


## The folder format


Entities are grouped into folders. A folder is a model root when it contains an `ignatius.yml` file. A `_groups/` folder at the root defines the groups. Any path segment that starts with an underscore is treated as meta-content and skipped during entity scanning.

```
models/
  ignatius.yml
  _groups/
    identity.md
    transactional.md
  identity/
    Party.md
    Person.md
    Business.md
  transactional/
    SalesOrder.md
    SO_Line.md
```

`ignatius.yml` marks the model root and carries optional display config. A minimal file is one line:

```yaml
name: My Schema
```

You can add `theme` and `branding` blocks to override colors and set a logo, title, or copyright line. When the file has only `name`, ignatius uses its built-in defaults for everything else.

### An entity file


Frontmatter carries the structure. The body is free-form documentation. The attribute table you see in the viewer is generated from the frontmatter, so do not write one in the body.

```markdown
---
entity: Person
classification: Subtype
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
  first_name:
    type: text
  last_name:
    type: text
  birthdate:
    type: date
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is a
---

# Person

Party that is a natural person.
```

Each column takes a logical `type` (text, integer, decimal, boolean, date, datetime, binary) and three optional fields: `nullable` (defaults to false), `default`, and `desc` for a short note on what the column is for.

A relationship names a `target` entity, maps the foreign-key columns with `on: { child_col: parent_col }`, marks whether it is `identifying`, and carries a `predicate` that labels the edge.

### A group file


Each group is a markdown file in `_groups/` with a label and a color in frontmatter and a prose description in the body. Groups set the border color and a pastel fill for their entities. They do not affect layout.

```markdown
---
label: Identity & Accounts
color: "#2ea043"
---

Party identity, classifications, and ID documents.
```


## What gets derived


You describe the structure. ignatius derives the rest.

- **Cardinality** comes from the primary-key layout, the relationship type, and foreign-key nullability. There is no `cardinality` field to set. An identifying edge where the child's primary key equals the foreign key exactly is one-to-one; a child with extra primary-key columns is one-to-many. A nullable foreign key makes the parent side optional.
- **Classification** comes from how an entity connects to others. An entity listed as a member of another's `subtypes` block is a subtype. Two or more identifying parents make it associative; one makes it dependent; none, in most cases, makes it independent. Classification sets the node shape, so the diagram reflects structure without you labeling it.
- **Subtype clusters** render with diamond joiners between the basetype and its members. An exclusive cluster shows an X in the diamond; an inclusive one leaves it empty.

The full derivation rules live in `docs/design/markdown-driven-erd.md`.


## Themes


Colors and spacing come from a `theme` block in `ignatius.yml`. It defines separate `dark` and `light` palettes plus layout spacing. When the block is absent, ignatius uses its built-in defaults. All three subcommands read the same theme, so the interactive view, the data dictionary, and the static graph match.

```yaml
name: My Schema
theme:
  dark:
    background: "#0e1116"
    surface: "#161b22"
    text: "#e6edf3"
  light:
    background: "#ffffff"
    surface: "#f6f8fa"
    text: "#1f2328"
  spacing:
    nodeSep: 30
```

The interactive viewer also has a light/dark toggle that persists across reloads.


## Building the binary


`bun build --compile` produces a single executable named `ignatius` with the Bun runtime, the CLI, and the React viewer bundled in. It runs on its own with no install step.

```bash
bun run build:cli
```

That runs three stages in order: it bundles the React app, renames the hashed output files to stable names so they can be embedded, then compiles `src/cli.ts` into `dist/ignatius`. The `serve` and `dict` subcommands work without a prior bundle build; `graph` needs the embedded bundle, so build it first if you only ran `build:bundle`.


## Project layout


| Path | Contents |
|---|---|
| `src/cli.ts` | Argument parsing and subcommand dispatch |
| `src/server.ts` | The `serve` server with live reload over SSE |
| `src/parse.ts` | Reads the folder, parses frontmatter, derives the model |
| `src/App.tsx` | The React viewer: Cytoscape graph, modals, theme toggle |
| `src/generators/` | Static output for `dict` and `graph` |
| `models/` | A reference schema used as the default folder |
| `docs/design/` | Design documents for the format and the CLI |

The stack is Bun, React 19, Cytoscape.js with the ELK layered layout, `markdown-it` for prose, and `yaml` for frontmatter. The crow's-foot cardinality markers are a custom SVG overlay drawn on top of the graph.


## Modeling skill


`/ignatius-modeling` is a Claude Code skill that guides you through authoring a new entity file or bootstrapping a complete model skeleton via Q&A, then verifies the result with `ignatius dict`.

**Prerequisites:** Claude Code with skill support; the `ignatius` binary on your `$PATH` or built locally (`bun run build:cli` → `dist/ignatius`).

### Modes

| Invocation | What it does |
|---|---|
| `/ignatius-modeling entity` | Interactive Q&A to author one entity `.md` file |
| `/ignatius-modeling model` | Bootstrap a new model skeleton (`ignatius.yml`, group files, directories) |
| `/ignatius-modeling` (no arg) | Prompts you to choose `entity` or `model` |

```bash
# Add a new entity to an existing model
/ignatius-modeling entity

# Start a new model from scratch
/ignatius-modeling model
```

### Authoring convention axis

The skill asks once per model which key convention you are using and carries that answer through the session.

| Convention | PK shape | FK placement |
|---|---|---|
| `key-inherited` | Composite: parent PK columns + local discriminator | FK columns live inside the child PK |
| `orm-oriented` | Single surrogate `id` (integer autoincrement) | FK columns sit outside PK as plain columns |

You never set `classification` or `identifying` manually — the parser derives both from the key shape you describe.

### Verification loop

After writing each file the skill runs `ignatius dict <model-root>` and parses the lint findings from stderr. Findings are reported with fix hints; you can ask the skill to revise and re-run (up to five attempts). A clean run with no findings confirms the file is valid.


## Documentation


- `docs/design/markdown-driven-erd.md` covers the entity format, the derivation rules, and the visual notation.
- `docs/design/cli-and-outputs.md` covers the three output modes and the theme system.
