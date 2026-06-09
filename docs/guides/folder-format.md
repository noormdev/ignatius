# The folder format


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


## ignatius.yml


`ignatius.yml` marks the model root and carries optional display config. A minimal file is one line:

```yaml
name: My Schema
```

Top-level keys `name`, `version`, `description`, and `updated` populate the model metadata. You can add a `theme` block to override colors and spacing and a `branding` block to set a logo, title, or copyright line. When the file has only `name`, ignatius uses its built-in defaults for everything else. See [Themes and branding](themes-and-branding.md).


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


The target must match an entity id exactly (PascalCase). A link to an entity that does not exist renders as muted, non-clickable text and is reported as a `body.unknown_link` finding, so a typo never passes silently. See [Validation and findings](validation.md).


### Columns


Each column takes a logical `type` and three optional fields.

| Field | Default | Meaning |
|---|---|---|
| `type` | required | One of `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary` |
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


## A group file


Each group is a markdown file in `_groups/` with a label and a color in frontmatter and a prose description in the body. Groups set the border color and a pastel fill for their entities. They do not affect layout.

```markdown
---
label: Identity & Accounts
color: "#2ea043"
---

Party identity, classifications, and ID documents.
```

An entity whose `group` references a name with no matching `_groups/<name>.md` file renders without a color band and is flagged with an `entity.unknown_group` warning.


## The flows folder


A model can also carry data flow diagrams in an optional `flows/` folder at the root. Files under `flows/` are never scanned as entities — they describe processes, externals, and stores instead, and render in the app's Flows view. See [Process flows](flows.md) for the full format.
