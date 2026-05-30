---
name: ignatius-modeling
description: >
  Guide authoring an ignatius entity or bootstrapping a new model skeleton via Q&A.
  Use when authoring an ignatius model, bootstrapping a new models/ tree, or creating
  a new entity .md file. Trigger on '/ignatius-modeling', 'new entity', 'bootstrap a model',
  'new ignatius model', 'add entity'.
canonical_sources:
  - docs/spec/schema-lint-and-error-ux.md
  - docs/spec/derive-classification.md
  - docs/spec/ignatius-project-config.md
  - docs/design/markdown-driven-erd.md
---

# Ignatius Modeling Skill

Guides the user through authoring an ignatius entity `.md` file or bootstrapping a new
model skeleton. Writes real files to disk and verifies output with `ignatius dict`.

## Mode dispatch

Check the positional arg:

| Arg | Action |
|-----|--------|
| `entity` | Run the entity flow |
| `model` | Run the model bootstrap flow |
| missing / unknown | Ask: "Which mode — `entity` (add one entity) or `model` (bootstrap a new model skeleton)?" |

---

## Authoring convention axis

Pick once per model. Record in your working memory for the session.

| Convention | PK shape | FK placement |
|------------|----------|--------------|
| `key-inherited` | Composite: parent PK cols + local discriminator | FK cols live **inside** the child PK |
| `orm-oriented` | Single surrogate `id` (integer autoincrement) | FK cols sit **outside** PK as plain columns |

**Derivation rule (never ask the user):** The parser derives classification and `identifying`
from key shape automatically. Do NOT ask for `classification` or per-edge `identifying`.
Ask `reference: true?` only for lookup/code tables (drives the Classifier classification).

**Detect convention from existing model:** inspect one entity — if it has a composite PK
containing a FK column, it's `key-inherited`. If entities have a single-column `id` PK
with FK columns outside the PK, it's `orm-oriented`.

---

## Entity flow (CP-1)

### Step E0 — Locate the model root

If no models dir is evident from context, ask:
> "What is the path to your model root (directory containing `ignatius.yml`)?"

If multiple `ignatius.yml` roots exist, ask which one.

### Step E1 — Entity id

Ask: "Entity name (PascalCase, becomes the file name)?"

### Step E2 — Group

Ask: "Which group? (existing group names: `<list from _groups/*.md>`)"

If the group doesn't exist in `_groups/`, ask: "Group `<name>` not found. Create it now or
choose an existing group?"
- If create: run the group-creation sub-flow (Step E2a) before continuing.

After the group is known, check: file `<group>/<EntityName>.md` must not already exist in the model root.
If it exists, ask: "That entity already exists. Overwrite, pick a different name, or abort?"

#### Step E2a — Create group (sub-flow)
Ask:
1. Group slug (snake_case, becomes the filename and `group:` value)
2. Label (human-readable, e.g. "Sales & Orders")
3. Color (hex, e.g. `#2ea043`)
4. Optional one-line description

Write `_groups/<slug>.md`:
```markdown
---
label: <label>
color: "<color>"
---

<description or blank>
```

Create directory `<slug>/` if it doesn't exist.

### Step E3 — Convention

If you already know the model convention (from existing entities or model bootstrap), state it:
> "This model uses `key-inherited` convention. Continuing with that — say 'switch' to change."

Otherwise ask: "Authoring convention — `key-inherited` (parent PK propagates into child PK)
or `orm-oriented` (surrogate `id` per entity, FK columns outside PK)?"

### Step E4 — PK columns

Ask based on convention:

**key-inherited:**
> "PK columns — list them. For a root entity: just the local key (e.g. `party_id`).
> For a child entity: parent PK column(s) FIRST, then the local discriminator
> (e.g. `party_id, sales_order_id`). Parent PK cols must match exactly what's in the parent."

**orm-oriented:**
> "PK — use `id` (surrogate integer) unless you have a strong reason for another name."

### Step E5 — Relationships

Ask: "Does this entity reference any parent entities? (FK relationships)"

If yes, for each relationship collect:
1. `target` — parent entity name (PascalCase)
2. `on` mapping — `{ child_col: parent_col }` pairs
3. `predicate` — short phrase describing the relationship from child's perspective (e.g. "is placed by")

**Convention-contradiction check (run before proceeding to E6):**

| Convention | Contradiction | Prompt |
|------------|---------------|--------|
| `key-inherited` | PK does not include the parent's PK columns from the `on` mapping | "key-inherited requires the parent PK column(s) in the child PK. Include `<cols>` in PK, or switch to orm-oriented?" |
| `orm-oriented` | A FK column (`on` key) appears in the declared PK | "orm-oriented keeps FKs outside the PK. Remove `<col>` from PK, or switch to key-inherited?" |

If the user resolves by switching convention, loop back to E3.
If the user fixes the PK, loop back to E4 with the corrected answer prefilled.
Continue once consistent.

### Step E6 — Alternate keys (optional)

Ask: "Any alternate keys (UNIQUE constraints)? (y/n)"
If yes, collect: rule name + columns array. Repeat for each AK.

### Step E7 — Columns

Ask: "List the non-PK columns. For each: name, type, nullable? (default false), optional default, optional desc."

Valid types: `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`

Note: PK columns must also appear in `columns` with their types.

### Step E8 — Reference table

Ask: "Is this a lookup/code table (reference: true)? (y/n, default n)"

Only say yes for static code tables like PartyType, Status, Currency.

### Step E9 — Body description (optional)

Ask: "Optional one-sentence description for the entity body? (leave blank to skip)"

### Step E10 — Write the file

Construct and write `<group>/<EntityName>.md` using the entity template below.

Then run the verification loop (Step V).

---

## Model bootstrap flow (CP-2)

### Step M1 — Target directory

Ask: "Target directory for the new model? (default: `./models/<name>`)"

### Step M2 — Model name

Ask: "Model name (for `ignatius.yml` `name:` field and branding title)?"

### Step M3 — Default convention

Ask: "Default authoring convention — `key-inherited` or `orm-oriented`?
(This is recorded as a comment in `ignatius.yml` for future entity invocations.)"

### Step M4 — Theme (optional)

Ask: "Custom theme colors? (y/n, default n — uses parser defaults)"

If yes, collect dark + light palette values:

| Key | Dark default | Light default |
|-----|-------------|---------------|
| `background` | `#16171b` | `#f7f7f8` |
| `surface` | `#1f2127` | `#eceef0` |
| `border` | `#363941` | `#d6dade` |
| `text` | `#e8e9ec` | `#23262b` |
| `textMuted` | `#9aa0a9` | `#646b73` |
| `edgeIdentifying` | `#9aa0a9` | `#646b73` |
| `edgeReferential` | `#454852` | `#c2c8ce` |

Ask only for values the user wants to override; others inherit defaults.

### Step M5 — Branding (optional)

Ask: "Custom branding? (y/n, default n — uses built-in Noorm branding)"

If yes, collect: `title`, optional `subtitle`, `copyright.text`, `copyright.year` (default current year), `poweredBy` flag (default true).

### Step M6 — Groups

Ask: "Define at least one group. For each: slug (snake_case), label, color (hex)."

Collect groups until the user says done.

### Step M7 — Bootstrap entity (optional)

Ask: "Bootstrap a reference entity now? (y/n, default n)"

If yes, run the entity flow (E1–E10) within the new model context.

### Step M8 — Write skeleton files

Write:
1. `ignatius.yml` using the ignatius.yml template below
2. `_groups/<slug>.md` for each group
3. `<slug>/` directory for each group
4. Entity file if requested in M7

Then run the verification loop (Step V).

---

## Verification loop (CP-3)

After writing any files, run:
```
./dist/ignatius dict <model-root> -o /tmp/ignatius-skill-check.html
```

If `./dist/ignatius` is not found, try `ignatius dict <model-root> -o /tmp/ignatius-skill-check.html`.

Parse stderr. Format: `<sev>  <ruleId>  <location>  <message>` (two spaces between fields).

**Rule reference table** (for reporting fix hints without grepping source):

| ruleId | Severity | Class | Title | Fix hint |
|--------|----------|-------|-------|----------|
| `parse.invalid_yaml` | error | B | Invalid YAML frontmatter | Fix YAML syntax — check indentation, unclosed brackets, invalid characters |
| `parse.missing_id` | error | B | Missing entity id | Add `entity: <EntityName>` to frontmatter |
| `parse.empty_frontmatter` | error | B | Empty frontmatter | Add at minimum `entity: <EntityName>` between the `---` fences |
| `entity.missing_pk` | warn | A | Missing primary key | Add `pk:` array with at least one column name |
| `entity.missing_columns` | warn | A | No columns defined | Add `columns:` map with at least the PK column types |
| `entity.invalid_field_type` | warn | A | Invalid field shape | `pk` must be an array of strings, `columns` must be a map — fix the field shape |
| `entity.unknown_group` | warn | A | Unknown group | Create `_groups/<name>.md` or correct the `group:` value |
| `edge.unknown_target` | error | B | Edge target not in model | Add the missing entity file or correct the `target:` name |
| `edge.dangling_fk_column` | warn | A | FK column not on source entity | Add the column to the entity's `columns` map or fix the `on:` mapping |
| `cluster.missing_basetype` | error | B | Subtype cluster basetype not in model | Add the basetype entity file or fix the basetype name |
| `cluster.missing_member` | warn | A | Subtype cluster member not in model | Add the member entity file or remove it from `members:` |
| `cluster.no_discriminator` | warn | A | Exclusive subtype cluster has no discriminator | Convert `members:` from list form to map form with discriminator values |

**Loop behavior:**

- Exit code 0, no stderr lines → success. Report "Verified clean — 0 findings."
- Findings present → report each as: `[<sev>] <ruleId> @ <location>: <message>` + fix hint from table above.
- Ask: "Revise the file(s) to fix these findings? (y/n)"
  - If yes: re-ask only the relevant Q&A steps with prior answers prefilled, rewrite, re-run.
  - If no: leave as-is, surface findings to user, exit.
- Max 5 attempts. On attempt 5 failure: "Max attempts reached. Remaining findings: <list>. Fix manually."

---

## Reference templates

### Entity `.md` template

```markdown
---
entity: <EntityName>
group: <group-slug>
pk:
  - <pk_col_1>
  # - <pk_col_2>  # key-inherited: add parent PK cols before local discriminator
columns:
  <pk_col_1>:
    type: <type>
    desc: "<description>"
  # <other_col>:
  #   type: <type>
  #   nullable: true   # omit if false
  #   default: <value> # omit if none
  #   desc: "<description>"
# ak:                  # omit entire block if no alternate keys
#   - rule: "<unique rule name>"
#     columns: [<col1>, <col2>]
# relationships:       # omit entire block if no FK relationships
#   - target: <ParentEntity>
#     on:
#       <child_col>: <parent_col>
#     predicate: <short phrase>
# reference: true      # omit unless this is a lookup/code table
---

# <EntityName>

<Optional one-sentence description.>
```

### key-inherited dependent entity example

The canonical form — composite PK with a local discriminator, no cross-entity reference needed:

```markdown
---
entity: SalesOrder
group: transactional
pk:
  - party_id
  - sales_order_id
columns:
  party_id:
    type: integer
    desc: "Ordering party — identifies the owning party."
  sales_order_id:
    type: integer
    desc: "Identifier of the order within the party."
  ordered_at:
    type: datetime
    desc: "Timestamp the order was placed."
    default: now
  total:
    type: decimal
    desc: "Order total."
---

# SalesOrder

A sales order scoped to a party.
```

**Example: child entity referencing a parent (both entities present in the model)**

When the parent entity (`Party`) is also in the model, add a `relationships:` block. The FK
column (`party_id`) must already appear in the PK — that's what makes the edge identifying:

_Party.md (parent):_
```markdown
---
entity: Party
group: transactional
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Surrogate key for the party."
  name:
    type: text
    desc: "Party display name."
---

# Party

A person or organization that can place orders.
```

_SalesOrder.md (child referencing Party):_
```markdown
---
entity: SalesOrder
group: transactional
pk:
  - party_id
  - sales_order_id
columns:
  party_id:
    type: integer
    desc: "Ordering party — foreign key to Party."
  sales_order_id:
    type: integer
    desc: "Identifier of the order within the party."
  ordered_at:
    type: datetime
    desc: "Timestamp the order was placed."
    default: now
  total:
    type: decimal
    desc: "Order total."
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: is placed by
---

# SalesOrder

A sales order placed by a Party.
```

### orm-oriented entity example

```markdown
---
entity: SalesOrder
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  ordered_at:
    type: datetime
    desc: "Timestamp the order was placed."
  total:
    type: decimal
    desc: "Order total."
---

# SalesOrder

A standalone sales order entity.
```

**Example: ORM-style child entity referencing a parent (both entities present in the model)**

When the parent entity (`Party`) is also in the model, add a `relationships:` block. The FK
column (`party_id`) is a non-PK column — the edge is referential (non-identifying), which is
the orm-oriented style:

_Party.md (parent):_
```markdown
---
entity: Party
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  name:
    type: text
    desc: "Party display name."
---

# Party

A person or organization that can place orders.
```

_SalesOrder.md (child referencing Party):_
```markdown
---
entity: SalesOrder
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  party_id:
    type: integer
    desc: "Ordering party — foreign key to Party."
  ordered_at:
    type: datetime
    desc: "Timestamp the order was placed."
  total:
    type: decimal
    desc: "Order total."
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is placed by
---

# SalesOrder

A sales order placed by a Party.
```

### `_groups/<slug>.md` template

```markdown
---
label: <Human Readable Label>
color: "#<hex>"
---

<Optional one-line description of what this group contains.>
```

### `ignatius.yml` template

When emitting this file, substitute the convention chosen at M3 into the first comment line.
For example: `# Model convention: key-inherited` or `# Model convention: orm-oriented`.
Do not write the literal placeholder — replace `<chosen-convention>` with the actual value.

```yaml
# Model convention: <chosen-convention>
# (used by /ignatius-modeling skill to guide new entity authoring)
name: <Model Name>
# version: "1.0"
# description: <optional description>
# updated: "YYYY-MM-DD"

# theme:            # omit to use parser defaults
#   dark:
#     background: "#16171b"
#     surface: "#1f2127"
#     border: "#363941"
#     text: "#e8e9ec"
#     textMuted: "#9aa0a9"
#     edgeIdentifying: "#9aa0a9"
#     edgeReferential: "#454852"
#   light:
#     background: "#f7f7f8"
#     surface: "#eceef0"
#     border: "#d6dade"
#     text: "#23262b"
#     textMuted: "#646b73"
#     edgeIdentifying: "#646b73"
#     edgeReferential: "#c2c8ce"

# branding:         # omit to use built-in Noorm branding
#   title: "<Model Name>"
#   subtitle: "<optional subtitle>"
#   copyright:
#     text: "© <Org>"
#     year: <YYYY>
#   poweredBy: true
```

---

## Conventions reference

### Column types

`text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`

### Column properties

| Property | Required | Notes |
|----------|----------|-------|
| `type` | Yes | One of the valid types above |
| `nullable` | No | Default false; omit unless true |
| `default` | No | Literal value or function name (e.g. `now`) |
| `desc` | No | Purpose of the column — not a restatement of the name |

### Classification derivation (for reference, never ask)

The parser derives classification from key/relationship shape:

| Condition (first match wins) | Classification |
|------------------------------|----------------|
| `reference: true` OR legacy classifier field | Classifier |
| Appears as member in another entity's `subtypes` cluster | Subtype |
| Has 2+ parents where FK cols are in child PK | Associative |
| Has 1 parent where FK cols are in child PK | Dependent |
| Otherwise | Independent |

Edge `identifying` is derived: true when the FK columns from `on:` appear in the child's `pk`.

### IDEF1X cardinality derivation (for reference)

**Identifying edges** (FK cols in child PK):
- Child is subtype → `1 : 0..1`
- Child PK = FK cols exactly → `1 : 1`
- Child PK has cols beyond FK → `1 : many`

**Referential edges** (FK cols outside child PK):
- FK not nullable + forms AK → `1 : 1`
- FK not nullable + no AK → `1 : many`
- FK nullable + forms AK → `0..1 : 1`
- FK nullable + no AK → `0..1 : many`
