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

