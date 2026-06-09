# ignatius


ignatius turns a folder of markdown files into an interactive data model: an IDEF1X entity-relationship diagram, a searchable data dictionary, and SSADM data flow diagrams, all in one app. Each entity lives in its own `.md` file with YAML frontmatter for structure and a prose body for documentation. The tool reads that folder, derives the relationships, and renders the views — pan, zoom, click through, search. Markdown is the source of truth. The diagrams are generated, never hand-drawn.

You write the schema as text. ignatius works out the cardinality, the entity classification, and the subtype clusters from the structure you describe, then draws the crow's-foot notation for you. Add a `flows/` folder and the same entities appear as data stores in process flow diagrams that show how the business actually moves the data.


## Why markdown


A diagram drawn by hand drifts from the schema it documents. ignatius removes the drawing step. You describe entities, primary keys, columns, and relationships in frontmatter, and the layout follows from the data. Change a foreign key and the cardinality marker updates on the next reload. Add an entity file and it appears in the graph. The text diffs cleanly in version control, so a schema change reads like any other code change.


## Install


Install the CLI with one command — it detects your platform and downloads the matching binary from the [latest release](https://github.com/noormdev/ignatius/releases/latest):

```bash
curl -fsSL https://raw.githubusercontent.com/noormdev/ignatius/main/install.sh | sh
```

It installs to `/usr/local/bin` when writable, otherwise `$HOME/.local/bin`. Override with `IGNATIUS_INSTALL_DIR`, or pin a version with `IGNATIUS_VERSION=v0.2.0`. Windows users download `ignatius-windows-x64.exe` from the releases page. Prefer to build from source? See [Getting started](docs/guides/getting-started.md).

To author models from Claude Code with guided Q&A, install the `noorm-modeling` skill ([the modeling skill](docs/guides/modeling-skill.md)):

```bash
npx skills add https://github.com/noormdev/ignatius --skill noorm-modeling
```

Add `-g` to install it globally for every project instead of just the current one.


## Quick start


Point ignatius at a folder of entity files:

```bash
ignatius serve path/to/your/models --port 3000
```

Edit any file in the folder and the graph reloads in the browser without a refresh.


## Documentation


| Guide | What it covers |
|---|---|
| [Getting started](docs/guides/getting-started.md) | Install, build from source, and serve your first model |
| [Commands](docs/guides/commands.md) | `serve`, `export`, `validate`, and model discovery |
| [The folder format](docs/guides/folder-format.md) | `ignatius.yml`, entity files, columns, relationships, groups |
| [What gets derived](docs/guides/derivation.md) | Cardinality, classification, and subtype clusters |
| [Bidirectional predicates](docs/guides/predicates.md) | Forward and reverse edge labels with hover-swap |
| [Process flows](docs/guides/flows.md) | Data flow diagrams: processes, externals, stores, sub-DFDs |
| [Validation and findings](docs/guides/validation.md) | The linter, severity tiers, and where findings surface |
| [Themes and branding](docs/guides/themes-and-branding.md) | Color palettes, the light/dark toggle, logo and copyright |
| [The modeling skill](docs/guides/modeling-skill.md) | `/noorm-modeling` Q&A authoring in Claude Code |
| [Building from source](docs/guides/building-from-source.md) | Build stages, project layout, and tests |

The [glossary](docs/glossary.md) defines the shared vocabulary — DG, DD, DFD, data entity, data store, external entity — used across the app, the docs, and the code.


## Design and contract docs


Conceptual designs live in `docs/design/`; the implementation contracts derived from them live in `docs/spec/`. Start with `docs/design/markdown-driven-erd.md` for the entity format and the derivation rules. Contributors should also read `CONTRIBUTING.md`.
