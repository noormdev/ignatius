# ignatius


ignatius turns a folder of markdown files into an interactive IDEF1X entity-relationship diagram. Each entity lives in its own `.md` file with YAML frontmatter for structure and a prose body for documentation. The tool reads that folder, derives the relationships, and renders a graph you can pan, zoom, and click through. Markdown is the source of truth. The diagram is generated, never hand-drawn.

You write the schema as text. ignatius works out the cardinality, the entity classification, and the subtype clusters from the structure you describe, then draws the crow's-foot notation for you.


## Why markdown


A diagram drawn by hand drifts from the schema it documents. ignatius removes the drawing step. You describe entities, primary keys, columns, and relationships in frontmatter, and the layout follows from the data. Change a foreign key and the cardinality marker updates on the next reload. Add an entity file and it appears in the graph. The text diffs cleanly in version control, so a schema change reads like any other code change.


## Quick start


Download the binary for your platform from the [latest release](https://github.com/<owner>/<repo>/releases/latest), put it on your `$PATH`, then point it at a folder of entity files:

```bash
ignatius serve path/to/your/models --port 3000
```

Edit any file in the folder and the graph reloads in the browser without a refresh. Full install options, including building from source, are in [Getting started](docs/guides/getting-started.md).


## Documentation


| Guide | What it covers |
|---|---|
| [Getting started](docs/guides/getting-started.md) | Install, build from source, and serve your first model |
| [Commands](docs/guides/commands.md) | `serve`, `dict`, `graph`, and model discovery |
| [The folder format](docs/guides/folder-format.md) | `ignatius.yml`, entity files, columns, relationships, groups |
| [What gets derived](docs/guides/derivation.md) | Cardinality, classification, and subtype clusters |
| [Bidirectional predicates](docs/guides/predicates.md) | Forward and reverse edge labels with hover-swap |
| [Validation and findings](docs/guides/validation.md) | The linter, severity tiers, and where findings surface |
| [Themes and branding](docs/guides/themes-and-branding.md) | Color palettes, the light/dark toggle, logo and copyright |
| [The modeling skill](docs/guides/modeling-skill.md) | `/ignatius-modeling` Q&A authoring in Claude Code |
| [Building from source](docs/guides/building-from-source.md) | Build stages, project layout, and tests |


## Design and contract docs


Conceptual designs live in `docs/design/`; the implementation contracts derived from them live in `docs/spec/`. Start with `docs/design/markdown-driven-erd.md` for the entity format and the derivation rules. Contributors should also read `CONTRIBUTING.md`.
