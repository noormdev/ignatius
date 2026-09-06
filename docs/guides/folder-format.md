# The folder format


A folder is a model root when it contains an `ignatius.yml` file. Five top-level folders are recognized — `data/`, `flows/`, `groups/`, `externals/`, and `stores/`. Everything else at the root is free-form: notes, scratch files, or any other markdown you keep nearby are never scanned.

```
models/
  ignatius.yml
  data/
    identity/
      Party.md
      Person.md
      Business.md
    transactional/
      SalesOrder.md
      SO_Line.md
  groups/
    identity.md
    transactional.md
  externals/          # optional — shared external definitions for DFDs
  stores/             # optional — shared non-db store definitions for DFDs
  flows/              # optional — data flow diagrams
  notes/              # free-form; ignored by the parser
```

Entities live under `data/<group>/<Entity>.md`. The group name comes from the entity's `group:` frontmatter field — the subdirectory path under `data/` is just a convenience for organization; the parser uses the frontmatter value, not the folder name. `groups/` is optional: a model with no `groups/` directory parses with zero groups and no error. `externals/` and `stores/` are the global registries for DFD authoring (see [Process flows](flows.md)).


## ignatius.yml


`ignatius.yml` marks the model root and carries optional display config. A minimal file is one line:

```yaml
name: My Schema
```

Top-level keys `name`, `version`, `description`, and `updated` populate the model metadata. You can add a `theme` block to override colors and spacing and a `branding` block to set a logo, title, or copyright line. When the file has only `name`, ignatius uses its built-in defaults for everything else. See [Themes and branding](themes-and-branding.md).

Two more keys control the generated routers described below:

```yaml
index_file: index.md   # default; the router filename written into every organizing folder
harness: auto           # auto | claude | agents | both — which agent guidance files `index --agents` writes
```

`index_file` names the router file `ignatius index` writes into `data/`, every subdirectory of `data/` that holds entity files, `groups/`, `flows/`, each flow folder, each sub-DFD folder, `externals/`, and `stores/`. It must be a bare filename ending in `.md` — a path or a different extension fails validation (`config.index_file_ext`, `config.index_file_path`).

That filename is reserved. No entity file may use it: a `data/**/*.md` file matching `index_file` that also declares `entity:` fails validation (`config.index_file_entity`), naming the reserved filename directly rather than the generic "missing id" error. A file matching `index_file` that declares no `entity:` is treated as a router and skipped by the scan, not read as a broken entity.


## Generated routers


`ignatius index <model-root>` writes one router file per organizing folder, so a reader descends the tree one small table at a time instead of opening every file. Each router carries a `Name | Kind | Description | Go` table — `Kind` is `folder` for a subdirectory row or the entity/node classification for a leaf, `Description` is that file's own `description:` frontmatter, and `Go` is a clickable relative link ending in `.md`.

Every row also carries the SHA-256 of its target. A folder's digest hashes its own row hashes, and a parent's row for a child folder carries that child's digest — so editing one entity file changes exactly the digests on its ancestor path and nothing else.

Generated content sits inside an `<ignatius-index>` region, with a `<ignatius-breadcrumb>` region for the `↑` navigation line directly above it:

```markdown
<ignatius-breadcrumb>

↑ [Data](../index.md) · [My Schema](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/identity" count="3" depth="2" digest="sha256:…">

| Name | Kind | Description | Go |
|---|---|---|---|
| Party | Independent | Root actor; every customer resolves to one. | [Party](Party.md) |

</ignatius-index>
```

**The generator owns only the bytes between its own tags.** A run replaces each `<ignatius-*>` region in place and leaves every byte outside it untouched — prose, headings, and a hand-authored `<ignatius-rules>` block all survive regeneration verbatim:

```markdown
<ignatius-rules>
A new entity here carries `party_id` as its first PK column.
</ignatius-rules>
```

That is what makes the router files safe to hand-edit: add a rules block once, and `ignatius index` never touches it. A file with no region gets one appended; a missing file is created. Running `ignatius index` twice over an unchanged model produces byte-identical output.

One constraint follows from how the generator finds its regions: **a line that starts with `<ignatius-` is always a region boundary**, and column-0 boundaries must pair open and close by name. Anywhere else on a line, the tag is text. To mention a tag inside a hand-authored `<ignatius-rules>` block, keep it off column 0: inline code, an indented line, or `&lt;ignatius-index&gt;`. A nested opener, an orphan or mismatched closer, an unclosed opener, or a duplicate region makes `ignatius index` refuse the file and name the line and the fix.

`ignatius validate --index <model-root>` recomputes every digest and reports drift as `index.stale`, writing nothing — the CI gate for "routers match the files on disk". `index.orphaned` warns when a router file left over from a previous `index_file` value is still on disk. A plain `ignatius validate` never pays this hashing cost; `--index` is opt-in.

`ignatius index --agents` additionally writes in-folder agent guidance into the model root: `AGENTS.md` (how to walk the model), `SKILL.md` (frontmatter that makes the folder a discoverable skill once it is symlinked into `.claude/skills/`), and, when `harness:` resolves to Claude, a `CLAUDE.md` that imports `AGENTS.md`. Nothing is written outside the model root. See [Commands](commands.md) for the flag, and `harness:` above for which files land.


## An entity file


Frontmatter carries the structure. The body is free-form documentation. The attribute table you see in the viewer is generated from the frontmatter, so do not write one in the body.

```markdown
---
entity: Person
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
    on:
      party_id: party_id
    predicate: is a
---

# Person

Party that is a natural person.
```

You do not set `classification` or per-edge `identifying` — ignatius derives both from the key shape. See [What gets derived](derivation.md).


### Linking to other entities


Reference another entity from the body with double brackets and it becomes a link:


```markdown
A **Person** is the specialization of a [[Party]] that is a natural human.
A customer settles invoices with a [[PaymentMethod|payment method]] on file.
```


`[[Party]]` links to the Party entity and shows "Party". `[[PaymentMethod|payment method]]` links to PaymentMethod but shows "payment method". In the graph viewer the link opens that entity's modal; in the data dictionary it jumps to that entity's section.


The target must match an entity id exactly (case-sensitive). A link to an entity that does not exist renders as muted, non-clickable text and is reported as a `body.unknown_link` finding, so a typo never passes silently. See [Validation and findings](validation.md).


### Code in the body


A tagged code fence is syntax-highlighted, in entity bodies and flow bodies alike:

~~~markdown
Selecting a party's usable methods:

```sql
select payment_method_id, type, label
from PaymentMethod
where party_id = @party_id;
```
~~~

Six languages ship with the viewer — `json`, `sql`, `javascript`, `typescript`, `python`, `bash` — along with their usual fence aliases (`js`, `ts`, `py`, `sh`, `shell`, `zsh`). An untagged fence, or one tagged with a language that is not bundled, renders as plain preformatted text rather than failing.

Highlighting is applied when the model is parsed, not in the browser, so a static `export` carries it with no extra work. Colours follow the viewer's own light/dark toggle.


### Columns


Each column takes a logical `type` and three optional fields.

| Field | Default | Meaning |
|---|---|---|
| `type` | required | One of `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`, `json` |
| `nullable` | `false` | Whether the column accepts null |
| `default` | none | A default value note |
| `desc` | none | A short note on what the column is for |


### Relationships


A relationship names a `target` entity and maps the foreign-key columns with `on: { child_col: parent_col }`. It carries a `predicate` that labels the edge in the graph and the dictionary.

```yaml
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: is a
```

A predicate can also carry both reading directions with `{ fwd, rev }`. See [Bidirectional predicates](predicates.md).


### Example rows


An entity can carry sample instances in `examples:` frontmatter — a list of row objects whose keys are column names:

```yaml
examples:
  - party_id: 1
    type: BUSINESS
  - party_id: 2
    type: PERSON
```

The rows render as a collapsible table in the entity dialog and the dictionary. Two or three realistic rows are enough; their job is to make the rules concrete — a sample row that violates a constraint you believe in reveals a modeling error no structural check can catch. Every key must be a real column (or PK column); the live server flags unknown keys with an `entity.example_unknown_column` warning.


### Structured values


A `json` column carries a document rather than a scalar. Write the value as nested YAML:

```yaml
columns:
  details:
    type: json
    nullable: true
    desc: "Instrument details, whose shape differs per method type."
examples:
  - payment_method_id: 1
    details:
      network: visa
      last4: "4471"
      exp_month: 11
```

The cell renders as a truncated monospace preview with an expander beside it; the expander opens the pretty-printed document in a dialog, layered over the entity dialog when you are already in one. A nested value renders this way on any column, so an author who omits the `json` type still gets a readable cell — declaring it is what additionally lets a value written as a quoted JSON string be recognised as a document.

Reach for `json` only where the shape is genuinely open-ended. A fixed set of known fields is columns, and a repeating group is a child entity; a `json` column with a stable shape is a modeling miss the viewer cannot help you with.


## A group file


Each group is a markdown file in `groups/` with a label and a color in frontmatter and a prose description in the body. Groups set the border color and a pastel fill for their entities. They do not affect layout.

```markdown
---
label: Identity & Accounts
color: "#2ea043"
---

Party identity, classifications, and ID documents.
```

An entity whose `group` references a name with no matching `groups/<name>.md` file renders without a color band and is flagged with an `entity.unknown_group` warning.


## The flows folder


A model can also carry data flow diagrams in an optional `flows/` folder at the root. Files under `flows/` are never scanned as entities — they describe processes, externals, and stores instead, and render in the app's Flows view. See [Process flows](flows.md) for the full format.
