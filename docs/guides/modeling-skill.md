# The modeling skill


`/noorm-modeling` is a Claude Code skill that guides you through authoring a new entity file or bootstrapping a complete model skeleton via Q&A, then verifies the result with `ignatius dict`.

**Prerequisites:** Claude Code with skill support, and the `ignatius` binary on your `$PATH` or built locally (`bun run build:cli` produces `dist/ignatius`).


## Modes


| Invocation | What it does |
|---|---|
| `/noorm-modeling entity` | Interactive Q&A to author one entity `.md` file |
| `/noorm-modeling model` | Bootstrap a new model skeleton (`ignatius.yml`, group files, directories) |
| `/noorm-modeling` (no arg) | Prompts you to choose `entity` or `model` |

```bash
# Add a new entity to an existing model
/noorm-modeling entity

# Start a new model from scratch
/noorm-modeling model
```


## Authoring convention axis


The skill detects which key convention a model uses from the shape of its existing entities, rather than asking you to pick a mode — and a model can mix both styles per entity.

| Convention | PK shape | FK placement |
|---|---|---|
| `key-inherited` | Composite: parent PK columns + local discriminator | FK columns live inside the child PK |
| `orm-oriented` | Single surrogate `id` (a plain column, typically integer or uuid) | FK columns sit outside the PK as plain columns |

You never set `classification` or `identifying` manually. The parser derives both from the key shape you describe. See [What gets derived](derivation.md).


## Verification loop


After writing each file the skill runs `ignatius dict <model-root>` and parses the lint findings from stderr. Findings are reported with fix hints, and you can ask the skill to revise and re-run (up to five attempts). A clean run with no findings confirms the file is valid. See [Validation and findings](validation.md) for the rules it checks against.
