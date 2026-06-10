## Reverse-engineering an existing system (CP-R)

Extract a model — both the ER (entities) and the DFDs (processes/flows) — from a system that
already exists, instead of from the user's description. Use this when the source is an
artifact: a live database, a schema dump / DDL, ORM model files, a codebase, stored procedures,
an API surface, or production sample data. This is `discover` mode's other evidence source: the
five gates in `references/discover-flow.md` still govern what enters the model — here the
evidence comes from reading the system rather than interviewing the user.

### Principle: read, don't invent (the IDEF1X spirit)

Reverse-engineering is disciplined and phased, the way an IDEF1X project is: you reconstruct
the existing structure faithfully from evidence, you migrate keys exactly as the real schema
does, and you do not guess. Two rules govern the whole exercise:

- **Every extracted thing still passes the five gates.** Reading a table gives you a candidate
  entity, not a finished one. A nullable column is the *maybe* Gate 2 must resolve; a table you
  can't state a purpose for is the *why* Gate 3 demands; two tables that are really one concept
  are the conflation Gate 1 catches. Extraction proposes; the gates dispose.
- **Faithful first, better second.** Capture what the system *is* before judging it. When the
  source carries an anti-pattern (plural table names, a surrogate `id` on every child where the
  real key is composite, a "junk drawer" table with no clear purpose), record it faithfully,
  then surface it to the user as a question — never silently "fix" it during extraction. The
  `database-designer` and `idef1x` skills carry the judgment for that conversation.

### Phase R0 — Inventory the sources

Establish what you can read, and locate the model root (or run `model` mode first if none
exists). Ask what is available and prefer the most authoritative source:

| Source | Yields | How to read it |
|--------|--------|----------------|
| Live DB / schema dump / DDL | entities, columns, PKs, FKs, constraints | `information_schema`, `CREATE TABLE` text |
| ORM models / migrations | entities, relationships, nullability | model class / migration files |
| Codebase (handlers, services, jobs) | processes, reads/writes, externals | the functions that touch the data |
| Stored procedures / queries | processes + exact column-level reads/writes | SQL `SELECT`/`INSERT`/`UPDATE` targets |
| API spec / route table | externals, process boundaries | endpoints + their callers |
| Production sample data | examples (Gate 5 evidence) | a few real rows per table |

Read the system; do not ask the user to retype what a file already states.

### Phase R1 — Extract the ER (entities first)

Reconstruct the data model from the schema, in IDEF1X order:

1. **Entities from tables.** One table → one candidate entity, **named exactly as the source
   names it** — `sales_orders` stays `sales_orders`, not `SalesOrder`. The entity id is
   free-form (the parser enforces no casing) and it is what every relationship `target`,
   `[[wiki-link]]`, and `db:` token must match, so a rename breaks the correspondence with the
   real system. If the user wants convention-cased names, that is a rename *decision* surfaced
   like any other anti-pattern (faithful first, better second) — never a silent cleanup. A pure
   join table (only FKs in its PK, no other meaningful columns) is an associative entity — note
   it; classification is derived by the parser, never declared.
2. **Attributes from columns.** Carry name, type, and nullability. Nullability matters: a
   `NOT NULL` FK is a mandatory parent; a nullable FK is optional — this is the existence rule
   the ER must preserve (see `references/entity-flow.md` E9).
3. **Primary keys, and detect the convention.** Read each PK. A composite PK that contains an
   FK column → `key-inherited`. A lone surrogate `id` with FKs as non-PK columns →
   `orm-oriented`. Detect the prevailing style and follow it per entity — do not normalize it
   away (see E3). This is the key-migration reconstruction that defines the convention axis.
4. **Relationships from foreign keys.** Each FK constraint → a `relationships:` edge,
   `on: { child_col: parent_col }`. Whether it is identifying is derived from whether the FK
   sits in the child PK — do not set it by hand. For the predicate, read the column/table names
   for the business verb; if the schema can't tell you, that is a Gate-3 question for the user
   ("what does the parent actually *do* with the child here?"), not a generic "has many".
5. **Subtype clusters from structure.** Shared-PK tables (a child whose entire PK equals the
   parent's PK) are subtype members; a discriminator column on the base selects them. Reconstruct
   the `subtypes:` block on the base (see E5a).

Write the entity files as you confirm each (`references/entity-flow.md` steps + templates).

### Phase R2 — Extract the DFDs (processes and flows)

Now read the *behavior* — the code and procedures that move the data:

1. **Processes from code units.** Each handler, service method, job, transaction, or stored
   procedure that transforms data is a candidate process. Name it as the verb it performs
   (`Collect Payment`, not `paymentController`). Group related ones into a diagram per business
   activity; decompose a large unit into a sub-DFD.
2. **Reads → inputs, writes → outputs, at column level.** This is the powerful part: a process's
   SQL tells you its flows exactly. A `SELECT party_id, type FROM party` inside a process is an
   input flow `from: db:Party, data: [party_id, type]`. An `INSERT INTO payment (...)` is an
   output flow `to: db:Payment` with those columns. The read/written column list *is* the flow's
   data contract — the same demand-list the `flow.unknown_attribute` rule checks.
3. **Stores.** A table the code touches → a `db:<Entity>` store (the entity from Phase R1). A
   cache/queue/file/log the code touches → the matching `kind:` store (`cache`/`queue`/`file`/
   `doc`/`manual`); author its `_stores/<slug>.md` with the reason it exists.
4. **Externals.** A caller outside the system — an end user, a third-party API, an upstream
   service — is an external entity. Author its `_externals/<Name>.md` with the rich body
   (role + what it does + expectations).

Write the flow files (`references/dfd-authoring.md` steps + `references/flow-templates.md`)
after the entities they reference exist.

### Phase R3 — Ground with real data

Pull a few real rows from the actual system for each entity and each flow (Gate 5). These become
the `examples:` — real production-shaped values are the best examples there are. Strip or mask
anything sensitive (PII, secrets, card numbers) before writing them into the model.

### Phase R4 — Reconcile through the gates, then verify

Run the full extracted set through the five gates before declaring it done:

- **Identify** — collapse tables that are really one concept; split a table that conflates two.
- **Decide** — every nullable column is a resolved decision, not a lingering maybe; record the
  existence/optionality rule in the body.
- **Justify** — every entity and store has a stated purpose; a table you can't justify is a
  question for the user (legacy cruft? genuinely needed?).
- **Derive** — every process's reads and writes are accounted for; a store only ever read or
  only ever written across the whole model signals a missing process.
- **Ground** — every entity and flow carries real example rows.

Then run the verification loop in `references/verification.md`. Reflect on findings and re-read
the source rather than guessing.

### What this does not do

- It does not reverse-engineer the model's own `.md` files back into an editing form — that is a
  separate concern.
- It does not silently "correct" legacy structure. Anti-patterns are surfaced to the user as
  decisions, never rewritten during extraction.

---
