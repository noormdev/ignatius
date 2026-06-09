# The modeling skill


`/noorm-modeling` is a Claude Code skill that guides you through authoring a model via Q&A — one entity, a data flow diagram, a fresh model skeleton, or a full Socratic discovery session that works the model out from how your business runs — then verifies the result with `ignatius validate`.

**Prerequisites:** Claude Code with skill support, and the `ignatius` binary on your `$PATH` or built locally (`bun run build:cli` produces `dist/ignatius`).


## Install


Install the skill into the current project with the [`skills`](https://www.npmjs.com/package/skills) CLI:

```bash
npx skills add https://github.com/noormdev/ignatius --skill noorm-modeling
```

This adds `noorm-modeling` to the project's `.claude/skills/`. Add `-g` to install it globally so it is available in every project on the machine. Reload skills in Claude Code and `/noorm-modeling` becomes available.


## Modes


| Invocation | What it does |
|---|---|
| `/noorm-modeling entity` | Interactive Q&A to author one entity `.md` file |
| `/noorm-modeling model` | Bootstrap a new model skeleton (`ignatius.yml`, group files, directories) |
| `/noorm-modeling flow` | Interactive Q&A to author a [data flow diagram](flows.md) — for when you already know your processes |
| `/noorm-modeling discover` | Socratic interview that works out the model from how your business runs, generating both entities and flows |
| `/noorm-modeling` (no arg) | Prompts you to choose a mode |

```bash
# Add a new entity to an existing model
/noorm-modeling entity

# Start a new model from scratch
/noorm-modeling model

# Author a DFD for processes you already know
/noorm-modeling flow

# Work out the model from a business description
/noorm-modeling discover
```


## flow vs discover


`flow` and `discover` are two doors into the same artifacts. Pick `flow` when you can already name your processes — it walks the structure step by step: processes as verbs, externals, the `db:`-or-`kind:` store decision, the data each flow carries, sample rows, and the business narrative. Pick `discover` when you know what the business does but have not decomposed it yet — the skill interviews you in plain language, derives the entities your processes require, writes those first, then writes the flows that reference them. When a real system already exists (a database, a schema dump, a codebase, an API), `discover` reads it instead of interviewing, then walks you through the judgment calls.

Both modes always produce example data — every entity gets sample rows and every process gets in/out example tables — because concrete instances expose wrong rules that pass every structural check.


## Authoring convention axis


The skill detects which key convention a model uses from the shape of its existing entities, rather than asking you to pick a mode — and a model can mix both styles per entity.

| Convention | PK shape | FK placement |
|---|---|---|
| `key-inherited` | Composite: parent PK columns + local discriminator | FK columns live inside the child PK |
| `orm-oriented` | Single surrogate `id` (a plain column, typically integer or uuid) | FK columns sit outside the PK as plain columns |

You never set `classification` or `identifying` manually. The parser derives both from the key shape you describe. See [What gets derived](derivation.md).


## Verification loop


After writing each file the skill runs `ignatius validate <model-root>` and parses the lint findings from stderr. Findings are reported with fix hints, and you can ask the skill to revise and re-run (up to five attempts). A clean run with no findings confirms the file is valid. See [Validation and findings](validation.md) for the rules it checks against.
