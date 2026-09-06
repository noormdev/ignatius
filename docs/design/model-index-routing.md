# Model index routing: generated per-folder routers, rolled-up digests, in-folder agent guidance


## Problem


A model root is a navigable structure to the SPA and a flat pile of markdown to
everyone else. `models/key-inherited/` holds 26 entity files across four groups,
two flows with nested sub-processes, and three registries. A reader landing on
the root, whether a human in a markdown viewer or an agent with a Read tool, has
two options: glob everything into context, or guess from filenames.

Filenames carry the entity id and nothing else. `PaymentAllocation.md` does not
say which group it belongs to, whether it is a base type or a subtype, or whether
opening it will answer the question at hand. So the cheap move is to read all 26
files, which is the move the model's own structure should make unnecessary.

The information a router needs already exists. `entity:` and `group:` are declared
in frontmatter; classification (Independent, Dependent, Subtype, Reference) is
derived from key shape at parse time; `label:` is declared on groups and `process:`
and `number:` on flow processes. Nothing assembles any of it into a table, and
nothing exposes a model to an agent harness without a hand-written pointer that
goes stale the first time an entity is added.


## Goals / Non-goals


**Goals**

- Every organizing folder carries a generated router file listing its children by
  name, kind, description, and a clickable relative link.

- Routers nest, so a reader descends root → section → group → entity by reading
  one small table per hop rather than loading the subtree.

- Per-file hashes roll up into a folder digest, and folder digests roll up to the
  root, so one hash proves the whole router is current and `validate` gates CI.

- Generated content sits inside a delimited region, so hand-authored steering
  rules can live in the same file and survive regeneration.

- Routers are clickable in a plain markdown viewer: GitHub, VS Code preview,
  Obsidian, mkdocs, VitePress.

- The folder orients any agent that opens a file in it, with no install step, and
  can be turned into an invocable skill by the user in one command.

- Nothing is written outside the model root, so the folder stays portable and the
  generator never touches a consuming repo's files.

**Non-goals**

- Replacing the SPA. `ignatius serve` stays the rich view; this is the flat-file
  view for readers who do not have it running.

- A new link syntax. `[[Entity]]` keeps its current meaning and its current
  consumer.

- A search index, an embedding store, or anything that ranks. The router routes.

- Config for which folders get routers, which columns the table carries, or how
  links are written. See Resolved questions.

- Migration tooling. Routers are generated, so there is nothing to migrate.


## Approaches


Three decisions, each with its own row set.

| # | Decision | Approach | Sketch | Cost | Risk |
|---|----------|----------|--------|------|------|
| A1 | Router placement | Single root manifest | One `index.md` at the model root listing all 26 entities | low | Flat. A 26-row table is the thing progressive disclosure exists to avoid, and it grows with the model |
| A2 | Router placement | Per-folder router | One router per organizing folder, nested to match the tree | med | Reserved filename collides with the `data/` entity scan |
| A3 | Router placement | JSON sidecar | `.ignatius-index.json` per folder | low | Not clickable in a viewer, not readable by an agent without a tool call per hop |
| B1 | Agent guidance | In-folder `SKILL.md` alone | The model root carries a skill file | low | Inert in place. Claude Code discovers skills only under `.claude/skills/`, so nothing reads it until a user installs it |
| B2 | Agent guidance | Adapter written into the consuming repo | A verb writes `.claude/skills/<model>/SKILL.md` at the repo root | med | The generator writes outside the model root: it must guess the repo layout, it can overwrite a hand-written `CLAUDE.md`, and the model folder stops being portable |
| B3 | Agent guidance | In-folder `SKILL.md` + harness-detected `CLAUDE.md` / `AGENTS.md` | Every guidance file lives in the model folder; installing it as a live skill is the user's move | low | Two files with overlapping content, resolved by making `CLAUDE.md` a one-line import of `AGENTS.md` |
| C1 | Generated-content delimiting | Whole file generated | Regeneration overwrites the file | low | Nowhere to put hand-authored rules. Anything a human adds is destroyed on the next run |
| C2 | Generated-content delimiting | XML managed region | Generator owns bytes between its own tags; everything outside survives | low | CommonMark requires a blank line inside the tags or the table renders as literal text |


## Recommendation


**A2 + B3 + C2.**

A2 because the router's value is the hop it lets a reader skip, and a flat
manifest has no hops. A3 loses the only two readers that matter: a markdown
viewer cannot click a JSON file, and an agent reading JSON pays a tool call per
level to learn what a rendered table gives it for free.

B3 because the model folder should explain itself to whoever opens it, and
because the generator has no business writing outside the model root. A verb that
drops files into someone's `.claude/` guesses the repo layout and can overwrite a
hand-written `CLAUDE.md`. A verb confined to the model folder cannot, and the
folder stays portable: copy it, submodule it, publish it, and its guidance travels
with it.

In-folder guidance works passively because Claude Code already looks there. The
memory documentation is explicit: "Claude also discovers `CLAUDE.md` and
`CLAUDE.local.md` files in subdirectories under your current working directory.
Instead of loading them at launch, they are included when Claude reads files in
those subdirectories" (`code.claude.com/docs/en/memory`). An agent that greps into
`data/transactional/` or opens `Party.md` gets the model's guidance with no
install step and no user action.

`AGENTS.md` is the canonical guide; `CLAUDE.md` is a shim that `@`-imports it.
That is the same page's prescribed pattern, because "Claude Code reads
`CLAUDE.md`, not `AGENTS.md`." One source of truth, no duplicated content, and a
non-Claude harness reads the file it already looks for.

`SKILL.md` stays in the folder as the invocation surface, inert until a user
wants it. Its `description` is a trigger the harness matches against a request,
which `AGENTS.md` has no contract for, so it earns a separate file rather than a
section. Turning it on is the user's decision and a one-liner:

```bash
ln -s ../../server/docs/data-model .claude/skills/alkane-model
```

C2 because the steering rules a model accumulates ("money columns are `decimal`,
never `float`") belong next to the table they constrain, and a generator that
owns the whole file cannot host them.


### The shape


Generated files marked `gen`. Every other file is hand-authored. Nothing is
written outside the model root, so the folder is self-contained and movable.

```
models/key-inherited/
├── ignatius.yml                  fixed name, model-root marker, declares index_file
├── AGENTS.md             gen     canonical agent guide: how to walk this model
├── CLAUDE.md             gen     `@AGENTS.md` + Claude-specific lines; auto-loads
├── SKILL.md              gen     invocation surface; inert until symlinked
├── index.md              gen     depth 0 · root router
│
├── groups/
│   ├── index.md          gen     depth 1
│   └── identity.md · catalog.md · transactional.md · reference.md
│
├── data/
│   ├── index.md          gen     depth 1 · fan-out by group
│   ├── identity/
│   │   ├── index.md      gen     depth 2 · fan-out by entity
│   │   └── Party.md · Person.md · Identity.md · SSN.md · …
│   ├── catalog/          (index.md gen)
│   ├── transactional/    (index.md gen)
│   └── reference/        (index.md gen)
│
├── flows/
│   ├── index.md          gen     depth 1
│   └── order-to-cash/
│       ├── index.md      gen     depth 2
│       ├── Create-Sales-Order.md              #1
│       └── Create-Sales-Order/
│           ├── index.md  gen     depth 3 · sub-DFDs nest arbitrarily deep
│           └── Validate-Customer.md · Record-Order.md
│
├── externals/index.md    gen
└── stores/index.md       gen
```


### Two audiences, two mechanisms, one folder


The guidance files carry no model content. Each is a pointer: what this folder
is, how to walk it, and the conventions needed to read what it points at. Adding
entities does not change them beyond a count and a digest.

| | Passive | Active |
|---|---|---|
| **Reader** | An agent already working in the repo that opens a file here | A user who wants to ask about the model by name |
| **File** | `CLAUDE.md`, or `AGENTS.md` for other harnesses | `SKILL.md` |
| **Trigger** | Reading any file in the folder | The harness matches a request against the skill `description` |
| **Install step** | None | `ln -s`, a copy, or a package |

The passive path is what makes the folder self-explaining. An agent told "add a
refund column" that opens `data/transactional/Payment.md` gets the key-style
convention and the `[[Entity]]` body rule automatically, instead of inferring
them from one file and getting them wrong.

The active path is the user's, deliberately. Installing a skill is a choice about
that machine and that repo, and the three ways to make it are all one step: a
symlink into `.claude/skills/`, a copy, or shipping the folder as a package that
lands somewhere already discovered.


### Descent is uniform at every depth, so a reader needs one rule


Each router carries one `↑` breadcrumb and N rows. A row whose `Kind` is `folder`
leads to another router; any other `Kind` is a leaf with real content.

```
index.md                        →  Which section?      Data / Flows / Groups / …
└─ data/index.md                →  Which group?        identity / transactional / …
   └─ data/identity/index.md    →  Which entity?       Party / Person / Identity / …
      └─ data/identity/Party.md    LEAF: pk, columns, examples, relationships
```

The `Description` column is the routing decision. It is what lets a reader skip a
subtree without opening it, which is the entire mechanism. That is why
`description:` is worth adding to frontmatter: it is not documentation, it is the
router's payload.

A rendered router:

```markdown
<ignatius-breadcrumb>

↑ [Data](../index.md) · [Key-Inherited](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/identity" count="8" depth="2"
                digest="sha256:4f2ac19">

| Name | Kind | Description | Go |
|------|------|-------------|-----|
| Party | Independent | Root actor; every customer resolves to one. | [Party](Party.md) |
| Person | Subtype | Natural-person subtype of Party. | [Person](Person.md) |
| Identity | Dependent | A government ID owned by a Party. | [Identity](Identity.md) |

</ignatius-index>

<ignatius-rules>
Hand-authored. The generator never touches this block.

- A new entity here carries `party_id` as its first PK column.
- The government-ID subtypes are exclusive. Adding a fifth means amending the
  cluster in [[Identity]], not dropping a file here.
</ignatius-rules>
```

Tag attributes are the machine-readable surface: an agent reads `digest`, `count`,
and `depth` without parsing YAML or the table. Unknown tags are stripped by GitHub
and VS Code, so a human sees a clean heading and table while a model reading raw
sees the structure.


### Two link dialects, split by job


Mixing them produces dead links in one consumer or the other.

| | Entity cross-reference | Router navigation |
|---|---|---|
| **Form** | `[[Party]]` | `[Party](Party.md)` |
| **Written in** | Entity and process bodies, by hand | Generated router tables |
| **Consumed by** | The SPA, via `src/model/wikilink.ts` | Markdown viewers, static site generators, agents |
| **Fails when misused** | A markdown link in a body renders as a dead relative href | A wikilink in a router is literal text outside Obsidian |

Router links always name the file. `[Identity](identity/)` shows a directory
listing on GitHub and resolves to nothing in VS Code preview;
`[Identity](identity/index.md)` clicks through in every target viewer. The `.md`
extension stays, because mkdocs and VitePress rewrite it and GitHub requires it.


### Fingerprints roll up, so one hash gates the tree


Each row carries its file's hash. A folder's digest hashes its row hashes. A
parent router stores only the child folder's digest, never the child's rows.

```
Party.md changes
  → its row hash changes in data/identity/index.md
    → that folder's digest changes
      → data/index.md's row for identity changes
        → the root digest changes
```

Verification is a `validate` concern, not an `index` one, so the router is a CI
gate rather than a file that quietly rots.


### CLI surface: writing and checking are different verbs


| Command | Writes | Purpose |
|---------|--------|---------|
| `ignatius index` | routers | Regenerate every `index.md` from the current files |
| `ignatius index --agents` | routers + guidance | The above, plus `AGENTS.md`, the `CLAUDE.md` shim, and `SKILL.md` |
| `ignatius validate --index` | nothing | Recompute digests and report drift as a finding |

Verification belongs on `validate` for three reasons. It already parses the
model, so the check costs a hash pass rather than a second parse. It already owns
the findings pipeline and the Class A/B exit-code machinery, so a stale router
becomes an `index.stale` RuleId alongside the other 27 rather than a bespoke exit
path. And it keeps CI to one command instead of two.

Making it an explicit `--index` flag rather than default behavior means a plain
`ignatius validate` never pays a full-tree hash. CI asks for both.

`--agents` is additive rather than exclusive: guidance files name the router
filename and carry the root digest, so writing them against stale routers would
ship a pointer to something that no longer exists. The flag decides *whether*
guidance files are written; `harness:` in `ignatius.yml` decides *which*.
Generating routers is inert, and writing a `CLAUDE.md` injects itself into an
agent's context, so the more invasive of the two is the one behind a flag.


### The router filename is config, because the target renderer decides it


`ignatius.yml` gains one key:

```yaml
name: Key-Inherited
index_file: index.md      # default. README.md for GitHub, _index.md for Hugo
harness: auto             # auto | claude | agents | both
```

`harness:` decides which guidance files `--agents` writes. `auto` emits
`AGENTS.md` and `SKILL.md` always, and adds the `CLAUDE.md` shim when a
`.claude/` directory or a `CLAUDE.md` exists anywhere up the tree. There is no
`none` value: not passing `--agents` already expresses that.

Flat and snake_case to match the existing `flow_rules:` and `sort_key:`. It takes
the whole filename rather than a stem, so the value is what lands on
disk and Hugo's `_index.md` needs no prefix-gluing special case.

`index.md` is the default because mkdocs, VitePress, and docsify resolve
`folder/` to it, which yields clean folder-level URLs on a rendered site.
`README.md` wins only on GitHub folder browsing.

Config makes the entry point unknowable to a cold reader, which `ignatius.yml`
already solves: it is the fixed-name model-root marker that discovery finds
(`docs/design/ignatius-project-config.md`). Resolution is
`find ignatius.yml` → `read index_file` → `open <root>/<index_file>`, and below
the root nothing resolves because every link is written out in full. Only the
first hop consults config, and the guidance files name the router filename
outright, so an agent that arrives through them skips even that.


### `index.md` under `data/` is currently a hard parse error


`parseModels` globs `data/**/*.md` (`src/model/parse.ts:234`) and raises
`parse.missing_id` as an **error** for any file lacking an `entity:` key
(`src/model/parse.ts:288`). A router dropped into `data/identity/` fails
`ignatius validate` today.

The flow scans need the same skip. `src/flows/flow-parse.ts` reads every `*.md`
in a flow folder, in `externals/`, and in `stores/` as a definition, so a router
in any of them raises `parse.invalid_yaml`, which is Class B; once
`validate --index` exists, that would fail every indexed model. The skip lands in
all five scans.

`ignatius.yml` is read at `src/model/parse.ts:173`, before the scan, so the
configured filename is in scope at the skip site with no reordering and no second
read. The skip compares the basename, not a suffix, or an entity file named
`Reindex.md` gets silently dropped.

Four validation rules come with the key:

| Rule | Condition | Severity |
|------|-----------|----------|
| `config.index_file_ext` | Value does not end in `.md` | error |
| `config.index_file_path` | Value contains `/` or `..` | error |
| `config.index_file_entity` | A file matching `index_file` under `data/` declares `entity:` | error, with a message naming the reserved filename rather than the generic `parse.missing_id` |
| `index.orphaned` | A file matching a previously-used router name still exists after `index_file` changed | warning from `validate --index` |

The orphan rule is the one non-obvious failure mode of making the name
configurable. Switching `index.md` to `README.md` leaves the old routers on disk
carrying valid-looking links and a digest nothing will ever check again.


## Resolved questions


- **What the guidance files contain.** Name, description, the root router
  filename, the model's key-style convention, the `[[Entity]]` body rule, and the
  digest at generation. No entities, no columns, no relationships. Content in a
  guidance file is content that goes stale outside the digest's reach.

- **A generated `CLAUDE.md` never clobbers a hand-written one.** Its content goes
  inside the same `<ignatius-...>` managed region the routers use, appended when
  the file exists and created when it does not. This matters most when a model
  root is also a repo root. C2 buys the protection; no separate mechanism.

- **The write contract: the CLI owns the bytes between its own tags, and nothing
  else.** This holds for every generated file, routers and guidance alike. A run
  replaces each `<ignatius-*>` region in place and leaves every byte outside it
  untouched, so prose, headings, hand-authored rules, and another tool's content
  all survive. A file with no region gets one appended; a file that does not
  exist is created.

  The one exception is forced from outside: `SKILL.md` carries YAML frontmatter
  (`name`, `description`) because the harness requires it to discover the skill
  at all, so the generator owns that block too. It owns nothing else in the file.
  Routers need no exception, since tag attributes already carry `digest`,
  `count`, and `depth`.

- **Guidance files stay short.** Claude Code targets "under 200 lines per
  CLAUDE.md file" and adherence drops as they grow. A pointer plus conventions
  fits well under that; anything approaching it means model content leaked in.

- **The authoring skill is in scope, not a follow-up.** `skills/ignatius-modeling/`
  teaches the file format, so it drifts the moment `description:` becomes a
  field an author should fill and `index.md` becomes a name they must not use.
  Its templates, its authoring steps, and its verification loop all move with
  this change, per the surface-consistency rule in `CLAUDE.md`.

- **Symlinked skill directories work. Tested, not assumed.** A relative symlink
  from `.claude/skills/<name>` to a directory elsewhere in the repo is both
  discovered and invocable: a probe skill reached that way appeared in the
  available-skills list and returned its body verbatim when invoked. So the
  one-line install in the Recommendation is the supported path, and no
  `ignatius install-skill` verb is needed.

- **No maximum descent depth.** Routers nest as deep as the model does, and
  flows nest arbitrarily. `depth` in the tag reports which level a router sits
  at; it is not a cap and nothing enforces one. The `Kind` column already tells
  a reader when it has reached a leaf, which is the only signal the walk needs.

- **Writing and checking are separate verbs.** `ignatius index` writes,
  `ignatius validate --index` checks. Verification is not a mode of the generator,
  so there is no flag on `index` to name and no second parse to pay for.

- **Model-level `description:` already exists.** It is read as top-level meta at
  `src/model/parse.ts:181`, so the root router's summary line needs no new field.
  The new frontmatter `description:` applies to entity, group, flow, external, and
  store files only.

- **Uniform routers, including for one-file folders.** `stores/` holds a single
  file and still gets a router. A missing index at any level breaks the descent
  contract, and an agent that must special-case depth is an agent that reads the
  whole tree instead.

- **No config for table columns.** `Kind` and `Description` are the routing
  mechanism. Making them optional makes the router optionally useless.

- **No config for link style.** Extensionless links work only in site generators;
  `.md` works in site generators and in GitHub and VS Code.

- **Blank lines inside the XML region are required, not stylistic.** CommonMark
  ends a raw HTML block at a blank line. Without one after the opening tag and
  before the closing tag, the table inside renders as literal pipes.


- **A region boundary is a position, not a delimiter.** A `<ignatius-*>` tag
  that starts at column 0 and ends its line is a region boundary; anywhere else
  on a line it is text. Column-0 boundaries must pair open and close with
  matching names; a nested opener, an orphan closer, a mismatched closer, an
  unclosed opener, or a duplicate region all throw, with the line number and the
  fix in the message. There is no fence exemption and no inline-code exemption.
  Three attempts to exempt code spans by their delimiters each opened a new way
  for real markup to hide, because a delimiter can be accidental and a position
  cannot; markdown itself pushes every prose container (`- `, `> `, `| `,
  backtick, indent) off column 0. The one constraint this puts on a hand-authored
  `<ignatius-rules>` block: to show a tag as an example, indent the line or write
  `&lt;ignatius-index&gt;`. A column-0 fake region with no real sibling is
  replaced in place rather than refused, since refusing it would need a second
  scanner, which is the class of code the rule removes.


## Open questions


- **Whether `index.stale` is a Class A or Class B rule.** Class B fails the
  build, which is what "gates CI" means, but it also hard-fails anyone who edits
  an entity and runs `validate --index` before regenerating. Class A warns and
  lets a stale router reach main. Leaning B, since the fix is one command and the
  flag is opt-in, but it is a judgment call the spec settles.

- **Symlinks pointing outside the repo.** The tested case is a relative symlink
  within one repo, which is the recommended install. A model shared from a
  central location through an absolute symlink is untested.
