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
#     predicate: { fwd: <parent→child business verb>, rev: <child→parent business verb> }
#     # or a single string applied to both directions: predicate: <business verb phrase>
# reference: true      # omit unless this is a lookup/code table
examples:              # 2–3 sample rows (Step E7b) — every key must be in pk ∪ columns
  - { <pk_col_1>: <value>, <other_col>: <value> }
  - { <pk_col_1>: <value>, <other_col>: <value> }
---

# <EntityName>

<One or two sentences: what this entity represents in the business and why it exists.>

<!-- Include the sections below only when the user gave you content for them. -->

## Business rules

- <Rule, with the constraint it implies and its source. e.g. "Payment amount must be ≥ $5 (check constraint). Source: Billing, 2026-05 — chargeback cost below $5 exceeds revenue.">

## Lifecycle

- <States and transitions, and any gate/approval. e.g. "New rows start `pending`; a permission gate authorizes them to `active` before full access. Implies a separate authorization table.">

## Notes

- <Justification for any structural complexity — who decided and why.>
```

Example rows live in the `examples:` frontmatter block above, not in the body — the viewer
renders them as a table from the frontmatter. (Older entities may carry a prose `## Sample
rows` body table; read it when seeding, but author new examples as frontmatter.)

**Linking entities in the body.** Whenever the body names another entity, write it as a
wiki-link — `[[Party]]`, or `[[PaymentMethod|payment method]]` for custom display text. Wiki-links
are the *only* link form that resolves: the viewer turns them into in-app navigation and the
linter validates the target (`body.unknown_link`). A markdown file link like `[Party](Party.md)`
does **not** resolve — it renders as a dead relative link and is invisible to validation. Never
use markdown file links; always use `[[Name]]`. The body examples below show this in practice.

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
    predicate: { fwd: places, rev: is placed by }
---

# SalesOrder

A sales order placed by a [[Party]].
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
    predicate: { fwd: places, rev: is placed by }
---

# SalesOrder

A sales order placed by a [[Party]].
```

### Business-context example (the body carries the story)

What an entity looks like when Step E9 actually captured the business rules. The frontmatter is ordinary; the body is where the value lives. Note the bidirectional predicate phrased in domain language and the recorded source/justification for each rule. This is an illustration of the shape, not a required structure — capture whatever business context the user has.

<example name="entity-with-business-context">

```markdown
---
entity: Payment
group: billing
pk:
  - party_id
  - payment_id
columns:
  party_id:
    type: integer
    desc: "Paying party — foreign key to Party."
  payment_id:
    type: integer
    desc: "Identifier of the payment within the party."
  amount:
    type: decimal
    desc: "Payment amount in account currency."
  status:
    type: text
    desc: "Lifecycle state: pending | cleared | reversed."
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: { fwd: makes, rev: is made by }
---

# Payment

A single payment a [[Party]] makes toward an outstanding balance.

## Business rules

- `amount` must be ≥ $5.00 (check constraint). Source: Billing department, 2026-05 — processing and chargeback costs below $5 exceed the revenue, so sub-$5 payments are rejected at write time rather than collected.

## Lifecycle

- A Payment starts `pending`, moves to `cleared` once the processor confirms settlement, or `reversed` on chargeback. Only `cleared` payments count toward a balance.

## Notes

- The status state machine, not a boolean `is_paid`, is intentional: reversals must be distinguishable from never-cleared payments for reconciliation. Decided with Finance, 2026-05.
```

</example>

### Subtype cluster example (base + members, self-contained)

A complete exclusive cluster: a base entity that divides into two mutually-exclusive kinds,
selected by a discriminator. The `subtypes:` block lives on the **base**; each member is its
own entity sharing the base's PK with a relationship back. Example rows show the exclusivity
is real — every base row is exactly one member. This is the shape, not a required structure.

<example name="subtype-cluster">

_Party.md (base — declares the cluster):_
```markdown
---
entity: Party
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Unique identifier for the party."
  type:
    type: text
    desc: "Party kind — foreign key to PartyType.code (BUSINESS or PERSON)."
subtypes:
  - exclusive: true
    desc: Every Party is exactly one of Business or Person
    members:
      Business: { type: PartyType.code.BUSINESS }
      Person:   { type: PartyType.code.PERSON }
relationships:
  - target: PartyType
    on:
      type: code
    predicate: { fwd: classifies, rev: is classified by }
examples:
  - { party_id: 1, type: BUSINESS }
  - { party_id: 2, type: PERSON }
---

# Party

A person or organization the business transacts with. The Party holds what is common to both
kinds; each subtype holds what is specific to it.
```

_Business.md (member — shares Party's PK, relates back):_
```markdown
---
entity: Business
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "The Party this business is — shared key, foreign key to Party."
  legal_name:
    type: text
    desc: "Registered legal name of the business."
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# Business

The specialization of a [[Party]] that is a legal entity. Shares its identity with its Party — it
does not invent a new key.
```

_Person.md is authored the same way: PK `party_id`, person-specific columns, and the same
`is realized as` / `is a` relationship back to Party. Both members are listed in Party's
`subtypes.members` — membership is declared on the base, and classification as Subtype is
derived from it._

_The base above is key-inherited (PK `party_id`). When the base is orm-oriented instead (PK
`id`), members reuse that exact `id` column as their own PK and map back `id: id` — they share
the surrogate key verbatim, never introducing a renamed `<base>_id` column._

</example>

### `_groups/<slug>.md` template

```markdown
---
label: <Human Readable Label>
color: "#<hex>"
---

<Optional one-line description of what this group contains.>
```

### `ignatius.yml` template

When emitting this file, substitute the default key style chosen at M3 into the first comment
line. For example: `# Default key style: key-inherited` or `# Default key style: orm-oriented`.
Do not write the literal placeholder — replace `<chosen-default>` with the actual value.

```yaml
# Default key style: <chosen-default>
# (a suggestion the /noorm-modeling skill reads when authoring new entities;
#  individual entities may differ — it is not enforced)
name: <Model Name>
# version: "1.0"
# description: <optional description>
# updated: "YYYY-MM-DD"

# theme:            # omit to use parser defaults; user values deep-merge over them
#   dark:
#     background: "#0e1116"
#     surface: "#161b22"
#     border: "#30363d"
#     text: "#e6edf3"
#     textMuted: "#8b949e"
#     edgeIdentifying: "#8b949e"
#     edgeReferential: "#3d424a"
#   light:
#     background: "#ffffff"
#     surface: "#f6f8fa"
#     border: "#d0d7de"
#     text: "#1f2328"
#     textMuted: "#656d76"
#     edgeIdentifying: "#656d76"
#     edgeReferential: "#b0b8c1"
#   spacing:
#     nodeSep: 60
#   flowKinds:       # per-kind DFD store/external colors; partial overrides keep the rest
#     cache:
#       dark: { bg: "#3a2a00" }
#       light: { bg: "#fff3c4" }

# branding:         # omit to use built-in Noorm branding
#   logo: ./assets/logo.svg        # or { dark: ..., light: ... }; resolved from the model root
#   title: "<Model Name>"
#   subtitle: "<optional subtitle>"
#   copyright:
#     holder: "<Org>"
#     year: <YYYY>
#   poweredBy: true
```

---

