## Entity flow (CP-1)

### Step E0 — Locate the model root

If no models dir is evident from context, ask:
> "What is the path to your model root (directory containing `ignatius.yml`)?"

If multiple `ignatius.yml` roots exist, ask which one.

### Step E1 — Entity id

Ask: "Entity name (becomes the file name and the id used in relationships, wiki-links, and `db:` tokens)?"

The id is free-form — the parser enforces no casing. PascalCase (`SalesOrder`) is the greenfield convention; suggest it for new models, but match the prevailing style when the model already has one. When entities come from an existing system (reverse-engineering), keep the source's names verbatim — `sales_orders` stays `sales_orders`; renaming to convention is a user decision, never an automatic cleanup.

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

### Step E3 — Convention (derived default, not a mode)

Convention is not a mode you set — it is a consequence of how each entity shapes its key.
Read the prevailing style from the existing entities and use it only as the *default
suggestion* for this entity's PK. The user's structural choice wins; you follow it.

- **Detect:** scan a few existing entities. A composite PK that contains a foreign-key column
  → `key-inherited`. A single surrogate `id` PK with foreign keys as non-PK columns →
  `orm-oriented`. If **no entities exist yet** (a fresh model), read the
  `# Default key style:` comment at the top of `ignatius.yml` — the model bootstrap (M3)
  records the user's choice there — and use it as the default suggestion without re-asking.
- **If a prevailing style is clear,** state it as the default and move on — do not ask the
  user to confirm a mode:
  > "Existing entities here migrate parent keys into the child PK (key-inherited). I'll
  > default this entity to that shape; your PK choice at the next step decides it for real."
- **If the model is new or mixed** (no clear prevailing style), briefly describe the two
  shapes so the user's PK answer is informed, but still do not force a global choice:
  > "Two key styles are in play: key-inherited (parent PK migrates into the child PK) and
  > orm-oriented (surrogate `id`, FKs outside the PK). Pick per entity — your PK at the next
  > step is the decision."

Never record the convention as a declared mode. The next entity is free to differ; Step E5
nudges once if it does (see below).

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
1. `target` — parent entity id, matched exactly (case-sensitive)
2. `on` mapping — `{ child_col: parent_col }` pairs
3. `predicate` — the relationship in the language of the business. Ask for both readings:
   > "How would a domain expert describe this link, in both directions? Forward, parent → child (e.g. Party **makes payments using** PaymentMethod); reverse, child → parent (e.g. PaymentMethod **is used for payments by** Party)."

   - Write the object form `predicate: { fwd: <parent→child>, rev: <child→parent> }`. If the user gives only one phrase, accept the plain string form `predicate: <phrase>` (it applies to both directions).
   - Push past generic ORM verbs. If the user says "has many" / "belongs to" / "has", ask for the real domain verb: "What does the parent actually *do* with the child here?" The cardinality is already drawn by the crow's-foot marker; the predicate should add business meaning, not repeat it.
   - A good predicate is a verb phrase that makes the edge read as a complete sentence: `<Parent> <fwd> <Child>` and `<Child> <rev> <Parent>` should both be true sentences a stakeholder would recognize.

**Convention nudge (one-time, non-blocking):**

The user's PK shape *is* the convention for this entity — derive it, don't enforce it. If
this entity's key style differs from the prevailing style detected at E3, and you have not
already nudged once this session, surface it once as a question, not a correction:

> "Heads up — most entities here use surrogate `id` (orm-oriented), but this one migrates a
> composite key into its PK (key-inherited). Intentional? (either is fine.)"

Whatever the user answers, proceed with their structure. Record the deviation in the final
summary (e.g. "Note: Payment uses key-inherited keys; the rest of this model is orm-oriented
— derived from your PK shape."). Do not re-ask on later entities in the same session, and
never block or demand a fix. A model may legitimately mix key styles entity by entity.

Reference/code tables (`reference: true`, Step E8) are exempt: a natural-key PK like `code`
is neither orm-oriented nor key-inherited, so a code table never triggers the nudge.

### Step E5a — Subtype cluster (conditional)

Ask only when relevant — skip silently if the entity is neither a base that divides into
kinds nor a member of one:

> "Is this entity part of a subtype split — either a base type that divides into kinds, or
> one of those kinds?"

Subtype clustering is independent of key style; it is its own modeling decision, derived from
the cluster declaration — never ask the user to label an entity "Subtype". Two paths:

**A. This entity is the BASE (it divides into kinds).**

1. List the member entity names (each becomes its own entity file sharing this base's PK).
2. Exclusive or inclusive?
   - **Exclusive** — every base row is exactly one member (a Party is a Person XOR a
     Business). Requires a discriminator.
   - **Inclusive** — a base row may be several members at once. No discriminator required.
3. For an exclusive cluster, name the discriminator column (already a column on this base,
   often an FK to a code table) and the value that selects each member.

Write a `subtypes:` block on this base entity. Map form carries the discriminator; array form
is for inclusive clusters with no discriminator:

    subtypes:
      - exclusive: true
        desc: Every Party is exactly one of Business or Person
        members:
          Business: { type: PartyType.code.BUSINESS }
          Person:   { type: PartyType.code.PERSON }

    # inclusive, no discriminator:
    subtypes:
      - exclusive: false
        members: [Business, Person]

Each member entity must still be authored (run the entity flow for each) — it shares the
base's PK and carries a relationship back to the base (predicate reads `is a` / `is realized
as`).

**B. This entity is a MEMBER of an existing base.**

1. Confirm the base entity name.
2. Give this entity the base's PK column(s) — it shares identity, it does not invent a new
   key — plus only the columns specific to this kind. Reuse the base's PK column name
   verbatim, even when it is a generic `id`; do not rename it to `<base>_id`. (So a member of
   an orm-oriented base whose PK is `id` also has PK `id`, mapped back as `id: id`.)
3. Add a relationship back to the base on the shared PK, predicate e.g.
   `{ fwd: is realized as, rev: is a }`.
4. **Edit the base entity** to list this member under its `subtypes.members` (with the
   discriminator value if the cluster is exclusive). Membership is declared on the base —
   without that edit the cluster is incomplete and the linter will not classify this entity
   as a Subtype.

Classification as Subtype is derived from cluster membership — never declare it.

### Step E6 — Alternate keys (optional)

Ask: "Any alternate keys (UNIQUE constraints)? (y/n)"
If yes, collect: rule name + columns array. Repeat for each AK.

### Step E7 — Columns

Ask: "List the non-PK columns. For each: name, type, nullable? (default false), optional default, optional desc."

Valid types: `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`

Note: PK columns must also appear in `columns` with their types.

### Step E7b — Examples

Always run this step — do not skip or make it optional.

Generate 2–3 example rows for this entity. Do not ask the user to supply them; produce them yourself using the column definitions and business context gathered so far, then show the rows and offer to add more. (Exception: if a caller already elicited real instances — `discover` mode's Gate 5 — those instances *are* these rows; seed from them instead of generating fresh ones.)

**Row authoring guidance:**

- Use plausible domain values — names, dates, codes, amounts — that a domain expert would recognize. Not `foo`, `bar`, `1`, `test`.
- Exercise the interesting axes of this entity:
  - **Nullability** — at least one row should have a nullable column set to a value, and (when there are multiple rows) at least one should leave it null.
  - **Classification membership** — if the entity is part of a subtype cluster, let one row represent one member kind and another row represent a different kind (where possible).
  - **FK populations** — populate FK columns with values that match the example rows of the parent entity (use a realistic value, not `1` or `<parent_id>`). If parent examples are not yet written, use a plausible surrogate (e.g. the parent entity's natural key pattern).
- Rows are a `Record<string, unknown>[]` — keys must be a subset of `pk ∪ columns`. **Self-check every key against that set before writing** — the `entity.example_unknown_column` rule is live-server-only and `ignatius validate` never prints it, so a stray key sails through the verification loop and only surfaces as a warning in the running app. You are the gate here, not the validator.

**After generating:**

1. Show the rows to the user as a YAML preview.
2. Ask: "Add more rows? (y/n)"
3. If yes, collect them and extend the list.

Write the approved rows as the `examples:` block in the entity frontmatter (see template in `references/templates.md`).

Canonical source: `docs/spec/example-instance-tables.md`.

### Step E8 — Reference table

Ask: "Is this a lookup/code table (reference: true)? (y/n, default n)"

Only say yes for static code tables like PartyType, Status, Currency.

### Step E9 — Business context and rules

This is the step that makes an ignatius model more than a data dictionary. Do not reduce it to a one-liner. Draw out the business story behind the entity and record it in the body so it survives past this conversation and is available when someone develops against the schema.

Ask, in order, capturing whatever the user offers (skip a prompt only if they have nothing for it):

1. **Purpose** — "In one or two sentences, what does this entity represent in the business, and why does it exist?"
2. **Business rules and constraints** — "Any rules the business imposes on this data? Allowed value ranges, required combinations, things that must never happen." Treat answers as design inputs:
   - A value limit (e.g. "no payments under $5") is a **check constraint** — record the rule and that it constrains this entity.
   - A required-before-allowed condition is a **guard**; note what it gates.
3. **Lifecycle and state** — "Does a row move through states or require approval/authorization before it is fully usable? (e.g. new users authorized before full access)" If yes, this implies a **state machine / gate** and often additional tables (a permission gate, a transfer into authoritative tables once the gate passes). Capture the states, the transition, and what structures the gate implies — flag the implied tables to the user as follow-up entities to model.
4. **Existence and cascade** — ask only when the entity has a parent (a `relationships:` edge): "Can this entity exist without its parent — is the FK ever null? And if the parent row is deleted, what happens to this one — deleted too, blocked, or orphaned?" In the orm-oriented style nothing in the *key* records this, so it must be written down:
   - A mandatory parent is `nullable: false` on the FK column — surface it: the parent is an existence dependency even though no key migrated. The derived cardinality already reflects this (a non-null FK reads as `1 : many`, a nullable FK as `0..1 : many`).
   - Record the answer as a **Business rules** line, e.g. "An SO_Line cannot exist without its SalesOrder (FK NOT NULL); deleting a SalesOrder cascade-deletes its lines. Source: …". This is the rule key-inherited would assert through key placement; in orm-oriented it becomes a documented constraint, not a lost one.
5. **Justification for complexity** — for any rule or structure above, "Who decided this and why?" Record the source and rationale (e.g. "Billing department, 2026-05: chargeback costs below \$5 exceed revenue"). The justification is what stops a future developer from deleting complexity they don't understand.

**Example rows: revisit, don't re-ask.** The rows were already written at Step E7b — do not ask the user whether they want examples; they exist. Instead, check whether anything surfaced in this step changes them: if a business rule, lifecycle state, mandatory parent, or subtype emerged here that the E7b rows don't exercise, extend or adjust the `examples:` block now (one Party that is a Person and one that is a Business shows the exclusivity is real; a child row beside its parent shows no orphan is possible). Concrete instances expose wrong rules that pass every structural check.

Write what you gather into the entity body under clear headings (see the template). Capture the **source and reasoning**, not just the rule. If the user truly has nothing beyond a name, write a one-sentence purpose and move on — but ask first.

**Link to other entities.** When the body names another entity, write it as a wiki-link so it becomes navigable: `[[Party]]`, or `[[PaymentMethod|payment method]]` to show different text. In the viewer the link opens that entity's modal; in the dict it jumps to its section. The target must match an entity id exactly (case-sensitive) — a link to a non-existent entity renders muted and trips `body.unknown_link`, so only link to entities that exist (or will, by the end of the model).

### Step E10 — Write the file

Construct and write `<group>/<EntityName>.md` using the entity template below.

Then run the verification loop in `references/verification.md`.

---

