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

Then run the verification loop in `references/verification.md`.

---

