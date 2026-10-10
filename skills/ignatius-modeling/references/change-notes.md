## Change notes

`ignatius serve` diffs the model against a baseline the user last approved and marks every added, changed, and removed entity, column, relationship, and flow node. A change note tells the reviewer why those changes happened. The user reads the notes in the Changes panel, then accepts the whole state with `ignatius approve` (or the panel's Approve button), which rewrites the baseline and deletes the notes.

### When to write one

- One note per edit session: any `entity`, `flow`, or `discover` run that wrote or changed model files. One note covers every file the session touched.
- Write it last, after the verification loop is clean, so it describes the final files.
- If the user asks for more edits in the same session, update this session's note rather than adding a second.
- A `model` bootstrap writes no note: it creates the model from nothing, so there is nothing to diff against.
- A session that bootstraps and then keeps writing (`discover`, or `flow` with no model yet) runs `ignatius approve <model-root>` after the bootstrap files are written and before its first entity or flow write. Its note then covers only what came after the bootstrap.

### Before the first write

Check `<model>/.ignatius/` before the session's first write to an existing model:

| `baseline.json` | `changes/` | Do |
|-----------------|------------|----|
| present and valid (JSON with `version: 1`, a `model` object, and a `flows` array) | any | nothing; edit as usual |
| absent, or not valid | empty or absent | run `ignatius approve <model-root>`, then edit |
| absent, or not valid | holds files | stop; do not write |

With no baseline and no notes, nothing is pending, so `approve` accepts nothing; it records the untouched files as the starting point the diff measures from.

When notes exist without a baseline, `approve` would delete notes the user has not reviewed. Tell the user, and ask them either to read the notes and run `ignatius approve` themselves, or to restore `baseline.json`. Continue once one of them is done.

Never run `ignatius approve` after editing: that accepts your edits, which is the user's act.

**Why:** without a baseline, the first `serve` takes the edited files as the starting point, so the session's changes never show for review.

### What not to touch

- Never edit or delete `.ignatius/baseline.json`.
- Never delete or rewrite a note from an earlier session. `ignatius approve` deletes notes; that is the user's act.
- Never write anything else into `.ignatius/`.

### Where it goes

`<model>/.ignatius/changes/<slug>.md`, where `<model>` is the folder holding `ignatius.yml`. The slug is a short kebab-case summary (`split-invoice-lines.md`). If that file already exists, pick another slug.

### Format

```markdown
---
title: <one line, what changed>
entities:
  <EntityId>: [<column>, <column>]
flows:
  <diagram-id>: [<node-id>, <node-id>]
---

<Why the change was made, written for the reviewer.>
```

`title` is required. `entities` and `flows` are both optional; omit the one the session did not touch. An entity or diagram whose list would be empty takes `[]`. Frontmatter that fails to parse turns the note into a note error: the panel shows the error and the note covers nothing.

Use the names the files already use:

| Thing | Name to write |
|-------|---------------|
| Entity | its `entity:` id |
| Column | the key under `columns:` (or the `pk` member) |
| Diagram | its folder name under `flows/`; a sub-DFD's id is the owning process's id (its folder name) |
| Process | its file name without `.md` |
| External | the name after `ext:` (the `externals/<Name>.md` file name) |
| Store | the name after the prefix: the entity id for `db:Invoice`, the slug for `queue:invoice-events` |

### What a note must list

A note covers a change when it names it as below. Name everything the session changed, and only that.

| Change | Covered when the note |
|--------|-----------------------|
| Entity added or removed | names the entity (columns optional) |
| Entity field changed (`pk`, `ak`, `classification`, `group`, `description`, `examples`, `singleton`, subtypes) | names the entity |
| Column added, removed, or changed (`type`, `nullable`, `default`, `desc`) | names the entity and lists the column |
| Relationship added, removed, or changed | names the source or the target entity |
| Body text only | names the entity |
| Diagram added or removed | names the diagram |
| Process, external, or store added, removed, or changed | names the diagram and lists the node |

A rename is a removal plus an addition: list both names.

Externals and stores live once in `externals/<Name>.md` and `stores/<slug>.md`, but each diagram that references one shows it as its own node. Editing that file changes the node in every such diagram, so list the node under each of them. Adding a diagram's first reference to an external or store adds the node there; removing its last reference removes it.

When a relationship changes, name the child entity (the one holding the foreign key) even if the note already names the parent.

**Why:** a relationship change can re-derive the child's `classification`: adding a relationship whose foreign key is in the child's primary key turns an Independent entity into a Dependent one. That is a change to the child entity, and only the child's name covers it.

When a subtype cluster gains or loses a member, name that member even if the note already names the basetype.

**Why:** an entity listed in any basetype's `subtypes:` is classified as a Subtype, so adding or removing it re-derives its `classification`. That is a change to the member entity, and only the member's name covers it.

### What the user sees when it is wrong

| Flag in the Changes panel | Cause | Fix |
|---------------------------|-------|-----|
| Unexplained | a change no note covers | add the entity, column, diagram, or node to the note |
| Named but unchanged | a name in the note with no matching change | remove it, or make the change it promised |
| Note errors | frontmatter that does not parse, a missing `title`, or an `entities`/`flows` value that is not a list of names | fix the frontmatter |

Before finishing, check the note against the coverage table above: every change the session made is named, and every name matches a change. When `ignatius serve` is running, `curl -s localhost:<port>/api/model | jq .diff` returns the review: `items[].status` is `unexplained` for an uncovered change, `claims` lists names with no matching change, and `noteErrors` lists notes that failed to parse.

### The body

Write for the reviewer deciding whether to approve: the business reason, where the rule came from (who said it, which document), alternatives you rejected, and anything they should check. Do not list the files or columns; the panel already shows them.

### Example

The session added `line_total` to `Invoice`, created `InvoiceLine`, and changed the `Issue-Invoice` process to publish to a new `queue:invoice-events` store.

```markdown
---
title: Split invoice lines out of Invoice
entities:
  Invoice: [line_total]
  InvoiceLine: []
flows:
  order-to-cash: [Issue-Invoice, invoice-events]
---

Billing needs one row per charged item so partial credits can target a line
(the finance lead, in this session). `InvoiceLine` inherits the invoice key;
`Invoice.line_total` keeps the summed amount the statement prints. Issue-Invoice
now publishes to `invoice-events` so the ledger can post lines without polling.
```

### The model `.gitignore`

`.ignatius/` is local review state and is never committed. Every model folder carries a `.gitignore` next to `ignatius.yml` with this line:

```
.ignatius/
```

Create the file when it is absent; append the line when the file exists without it; never add it twice.
