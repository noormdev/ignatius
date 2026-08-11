## DFD authoring (CP-F)

Authors an SSADM data flow diagram (DFD) under a model's `flows/` directory — processes,
external entities, and data stores — and verifies it with `ignatius validate`. Use this when
the user already knows the processes their business performs. When they don't yet — when they
can describe what the business *does* but haven't named the processes, entities, and stores —
use `references/discover-flow.md` instead.

### What a DFD is for

Keep this framing in front of every question. A DFD does three things, in priority order:

1. **Explains what the business does** — each process is a verb the business performs.
2. **Shows how data moves** — each flow traces data from where it comes from to where it goes.
3. **Identifies what must be captured and stored** — each store answers "what persists here".

Two truths shape every step:

- **Processes are verbs.** Every process is an imperative phrase — *Collect Payment*, *Issue
  Invoice*, *Validate Customer*. Something that happens or will happen. If a name reads as a
  noun (a thing, not an action), it is an entity or a store, not a process — name it as the
  action that touches it.
- **A flow's label is a complete data contract.** The text on every arrow names *all* the data
  that crosses it — every field, not a vague noun. "order request" is a placeholder; the real
  label for a `db:` flow is the column list (`[party_id, sales_order_id, ordered_at, total]`).
  A `db:` flow's column list is checked against the entity at validate time
  (`flow.unknown_attribute`) — the DFD is a demand list on the data model.

### How the pieces connect

A process **reads from** and **writes to** data stores, and **exchanges data with** external
entities. That is the whole shape:

- An **external entity** is an actor outside the system — a source of requests and a sink for
  results (`Customer`, a payment gateway). Drawn green. It hands data to a process and receives
  data from a process.
- A **data store** is where data rests. Two kinds (see Step F4): a `db:` store *is* an existing
  ERD entity; a `kind:` store is a non-entity resting place (a log file, a queue, a cache).
- A **process** sits between them: it takes input data from externals and stores, transforms
  it, and produces output data to externals and stores. Every process has at least one input
  and at least one output.

### Step F0 — Locate the model root and read the entities

If no model root is evident from context, ask:
> "What is the path to your model root (directory containing `ignatius.yml`)?"

If no `ignatius.yml` exists anywhere, run `model` mode first (`references/model-flow.md`) to
bootstrap one — flows live inside a model.

Then read the existing entities (the `data/<group>/*.md` files) and any existing `flows/`. You need
the entity ids and their columns so `db:` stores and flow data-labels resolve against real
columns. Infer; don't ask the user to list entities you can read.

### Step F1 — Diagram identity

Ask: "What does this flow accomplish — a short name for the whole diagram (e.g. `order-to-cash`,
`refund`)?" The slug becomes the diagram's folder name under `flows/`; its display title is
derived from the slug automatically.

Then ask whether this is a top-level flow or a decomposition of an existing process:
> "Is this a standalone flow, or does it break down a process from an existing diagram?"

- **Standalone** → the diagram folder lives directly under `flows/`.
- **Decomposition** → it is a sub-DFD: it lives in a folder named exactly after the parent
  process file (parent `Collect-Payment.md` → child folder `Collect-Payment/`). Hold this; it
  matters at Step F8 and for balancing.

### Step F2 — Name the processes

Ask: "What does the business *do* in this flow? Name each step as an action."

Collect the processes as imperative verb phrases and number them (`1`, `2`, `3` …) in the order
they happen. The number is an id, not a strict sequence — it labels the process box. Aim for a
handful (roughly 3–7) at one level; if the user lists many more, that is the signal to
decompose one or more into sub-DFDs (Step F8).

**Filename = the phrase with spaces→hyphens, Title-Case preserved** (`Collect Payment` →
`Collect-Payment.md`). The filename minus `.md` is the process's id everywhere: the `proc:`
token, wiki-link targets, and the sub-DFD folder name at F8 all match it exactly. When the
model already has flow files, match their naming style instead — the Title-Case default is
for the first diagram, not a rule to retrofit onto an existing `flows/` tree.

For each process, the next steps (F3–F7) collect its connections, data, examples, and body.

### Step F3 — External sources and sinks (per process)

Ask: "Where does this step get data from outside the system, and what does it send back out?"

For each external the process talks to:

- Use the token `ext:<Name>` in the process's `inputs:`/`outputs:`.
- Externals are defined once at `externals/<Name>.md` (model-root level) and shared across every
  diagram at any depth. Before creating one, check whether it already exists — reuse the shared
  definition (the demo's `Customer` is defined once and referenced everywhere).
- If the external is new, you will author its file at Step F7 (it needs a rich body — see the
  business-context requirements there).

### Step F4 — Data stores (per process): the `db:` / `kind:` fork

For each place the process reads from or writes to, decide what kind of store it is. Ask first:
> "Does this data persist as a business record you'd find in the data model, or is it a
> supporting resting place — a log, a queue, a cache?"

Suggest the store kind from this menu:

- `db:` — **an existing ERD entity** acting as a store. Try this first: match the data to an
  entity you read at F0 and use the token `db:<Entity>`. A `db:` store opens the full entity in
  the viewer, so its data-labels must be that entity's columns.
- `cache` — fast transient lookup
- `queue` — work waiting to be processed
- `file` — an append-only log or document blob (e.g. a gateway log)
- `doc` — a generated document
- `manual` — a physical or off-system store
- `other` — anything that fits none of the above

The user may *describe* any kind of store, but the token prefix set above is closed — the
parser recognizes exactly these. When the user names a kind not on the menu (a waitlist, a
ledger), author it as `kind: other` with a `title:` carrying the real name, and reference it
as `other:<slug>`. Do not invent a new prefix: an unrecognized prefix is not read as a kind —
the token falls through to process-name resolution and fails validation with a misleading
`flow.unknown_process` error.

A business record is a `db:` store; a supporting resting place is one of the other kinds,
referenced as `<kind>:<slug>` (e.g. `file:gateway-log`, `queue:fulfilment-queue`) — you will
author `stores/<slug>.md` (model-root level) at Step F7.

**If the data is a business record but no entity exists for it yet**, stop and author the
entity first (run the entity steps in `references/entity-flow.md`), then come back and use
`db:<Entity>`. Never demote a business record to a `kind:` store just because the entity
hasn't been written — that loses the column validation and the entity dialog in the viewer.

Use the token in the process's `inputs:` (reads) and `outputs:` (writes).

### Step F5 — Data flows (per process): name every field

For each input and output, capture **all** the data that crosses the arrow:

- **`db:` flows** → the list of entity columns the process reads or writes
  (`data: [party_id, payment_method_id, payment_id, amount]`). Use the real column names; they
  are validated against the entity. This is the process declaring exactly what it depends on.
- **`ext:` and `kind:` flows** → a phrase naming the full payload
  (`data: payment details`, `data: gateway transaction reference, HTTP status, raw response`).
  Name everything that moves, not a one-word summary.

Write these as the `inputs:` and `outputs:` arrays in the process frontmatter (see
`references/flow-templates.md`). Every process needs at least one input and at least one output.

### Step F6 — Examples (always)

Run this for every process — it is not optional. Examples are what make a flow analyzable: they
show the actual data moving in and out, the same way entity sample rows show what a table holds.

Produce in/out example rows yourself from the data-labels and business context; don't ask the
user to hand them over. Then show them and offer to add more.

**Seeding `db:` examples** — when an input or output is a `db:<Entity>` flow, seed its rows from
that entity's own examples so the flow data matches the ERD. Handle whichever form the entity
carries:

1. **Entity has structured `examples:` frontmatter** → reuse those values directly.
2. **Entity has only a prose `## Sample rows` section** (a legacy form on older entities) →
   reuse the values from that table.
3. **Entity has neither** → co-create plausible rows with the user, using realistic domain
   values (real names, codes, amounts — not `foo`/`1`/`test`), consistent with the entity's
   columns.

Write the rows as the `examples:` block in the process frontmatter, split into `in` and `out`,
each entry titled by its `from`/`to` endpoint and a `label`. See the worked example in
`references/flow-templates.md`.

### Step F7 — Bodies: the business context (per node)

Every node carries a markdown body. This is where the *why* lives — the reason the thing exists.
A process, external, or store with no body is a box with no meaning. Capture the business story,
linking other nodes and entities with wiki-links (`[[Customer]]`, `[[Payment]]`) so they become
navigable.

- **Process body** — what the process does and why, in business terms. What it reads and what
  that tells it, what it writes and the rules on those writes (e.g. "amount must be positive"),
  and the reason any structural complexity exists. The demo `Create-Sales-Order.md` is the
  shape.

- **External body (required: role + what they do + expectations)** — paint the full picture of
  this actor's relationship with the business:
    - **Role** — who they are and how they relate to the business (and how they differ from any
      entity that records them — `Customer` the actor vs `[[Party]]` the stored record).
    - **`## What <Name> does`** — a list of every interaction they have with the business across
      all flows: what they send in, what they receive back.
    - **What they expect** — what the actor comes to the business *for* and what they expect in
      return.

- **Non-`db` store body (required: reason-for-existence + a `## Sample values` table)** —
    - **Why it exists** — the reason this resting place is distinct from the entities around it
      (the demo gateway-log: opaque blobs for reconciliation, not relational data; retained 7
      years for compliance).
    - **Sample values** — a few concrete rows (an array of objects rendered as a table) showing
      what the store actually holds.

- **`db` store** — its body is the entity's own narrative in the ERD. If that entity's body is
  thin (no statement of why it exists), this is the moment to enrich it — flag it to the user
  and add the purpose/rules to the entity file.

### Step F8 — Decompose into sub-DFDs (where warranted)

Offer a drill-down when a process hides a flow of its own — a sign is many data flows on one
process, or the user describing it with "and then…". Ask:
> "Does <process> break down into its own smaller steps worth their own diagram?"

If yes, the process becomes a sub-DFD parent: create a folder named exactly after the process
file and author the child processes inside it (run F2–F7 for them). When you do, **thread the
same data through both levels** — the data flowing in and out of the parent process is the same
data that crosses the boundary of its child diagram. Keep the labels identical so the levels
reconcile; nothing should appear or vanish between them.

**This step is recursive — there is no depth cap.** Any child process authored inside a sub-DFD
can itself be decomposed the same way: create a same-named folder next to the child's file and
apply F2–F8 to its grandchild processes. Repeat for as many layers as the model warrants. Dotted
process numbers compose automatically at every level — a process three layers deep reads something
like `1.4.2`, and one four layers deep reads `1.4.2.1`. The balancing constraint (`flow.unbalanced_decomposition`) applies at each level independently: every sub-DFD must balance with its
immediate parent, not with the root diagram.

### Step F9 — Write the files and verify

Lay the files out under the model root:

```
externals/<Name>.md               # shared externals, defined once at model root
stores/<slug>.md                  # shared non-db stores, defined once at model root
flows/
  <diagram-slug>/
    <Process-Name>.md             # one file per process
    <Process-Name>/               # sub-DFD folder (only if F8 decomposed it)
      <Child-Process>.md
      <Child-Process>/            # grandchild sub-DFD (F8 applied again, one level deeper)
        <Grandchild-Process>.md
```

Write each file using the templates in `references/flow-templates.md`, then run the verification
loop in `references/verification.md` against the model root. Flow findings use the `flow.*`
rules; reflect on each, map it to the step that produced it, and re-ask only that step rather
than regenerating everything.

---
