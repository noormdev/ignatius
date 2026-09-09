# Process flows


A model can carry data flow diagrams (DFDs) alongside its entities. A DFD shows what the business *does*: numbered processes transform data, external entities send it in and receive it out, and data stores hold what persists between steps. ignatius renders them in the SSADM style with Gane-Sarson notation — open-ended `D#` store boxes, numbered process hubs, green external boxes — in the **Flows** view of the app.

The same markdown-first rule applies: flows live as `.md` files with YAML frontmatter, the diagram is generated, and a `db:` store in a flow is the *same entity* you modeled in the ERD — clicking it opens the full entity dialog with columns, relationships, and examples.


## Folder layout


Flows live in a `flows/` folder at the model root. Each diagram is a folder; each process is a file inside it.

```
models/
  ignatius.yml
  data/
    identity/ ...             # entity files live under data/
  externals/
    Customer.md               # shared external, usable by every diagram
  stores/
    gateway-log.md            # optional description of a non-entity store
  flows/
    order-to-cash/
      Create-Sales-Order.md   # process 1
      Create-Sales-Order/     # same-named folder = sub-DFD of process 1
        Validate-Customer.md
        Record-Order.md
      Issue-Invoice.md        # process 2
      Collect-Payment.md      # process 3
    refund/
      Process-Return.md
```

The file name (minus `.md`) is the process id used everywhere — in `proc:` tokens, in `[[wiki-links]]`, and as the sub-DFD folder name. Name it as an imperative phrase with hyphens for spaces: `Collect Payment` → `Collect-Payment.md`.


## A process file


Frontmatter declares the data contract; the body explains the business. The flows on the diagram are generated from `inputs:` and `outputs:`.

```markdown
---
process: Collect Payment
number: 3
description: "Settles an invoice by recording a payment and allocating it against invoice lines."
inputs:
  - from: ext:Customer
    label: payment details
    data: card or account, amount, currency
  - from: db:PaymentMethod
    label: stored payment method
    data: [party_id, payment_method_id, type, label]
outputs:
  - to: cluster:settlement
    label: settled payment
    data:
      Payment: [party_id, payment_method_id, payment_id, amount]
      PaymentAllocation: [party_id, payment_method_id, payment_id, sales_invoice_id, line_seq]
  - to: file:gateway-log
    label: gateway response
    data: gateway transaction reference, HTTP status, raw response
  - to: ext:Customer
    label: receipt
    data: payment id, status, message
examples:
  in:
    - from: ext:Customer
      label: payment details
      rows:
        - { card: "****4242", amount: 49.99, currency: GBP }
        - { card: "****1234", amount: 199.00, currency: USD }
    - from: db:PaymentMethod
      label: stored card lookup
      rows:
        - { party_id: 1001, payment_method_id: 42, type: card, label: "Visa ending 4242" }
  out:
    - to: db:Payment
      label: settled payment record
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, amount: 49.99 }
        - { party_id: 1002, payment_method_id: 17, payment_id: 9002, amount: 199.00 }
    - to: db:PaymentAllocation
      label: allocation against the invoice line
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, sales_invoice_id: 5001, line_seq: 1 }
    - to: ext:Customer
      label: receipt
      rows:
        - { payment_id: 9001, status: captured, message: "Payment accepted" }
---

Settles an invoice by recording a [[Payment]] and allocating it.

Reads the customer's stored [[PaymentMethod]] (its `type` and `label`, e.g.
"Visa ending 4242"), records the `Payment` (`amount` must be positive),
then writes a [[PaymentAllocation]] linking that payment to the invoice line
it settles, both in one transaction. A receipt is returned to the [[Customer]].

This process is the reason `PaymentAllocation` is a five-part key: the
allocation is uniquely identified by the paying party, the method, the
payment, and the specific invoice line — every column this flow writes is
part of that key.
```

| Field | Required | Meaning |
|---|---|---|
| `process` | yes | The human label shown on the node |
| `number` | no | Local rank among sibling processes; falls back to file order. Full SSADM numbers (`1.2.1`) are composed from the folder nesting automatically |
| `inputs` / `outputs` | yes | The flows. Each names an endpoint (`from:`/`to:`), the `data:` it carries, and a prose `label:` the diagram shows for it |
| `examples` | no | Sample in/out rows rendered as tables in the process dialog, one entry per flow |
| `description` | no | One line saying what the process does and when it runs. It is the Description cell in the flow folder's generated router, so a reader can open or skip the process without reading its body |

The `data:` field is the flow's contract. On a `db:` endpoint it is **always column names** — a string for one column, a list for several — and every name is checked against the entity's `pk` and `columns` (the `flow.unknown_attribute` rule). On a `cluster:` endpoint it is a map from member entity to that entity's column list, checked the same way. On any other endpoint it is a phrase; make it enumerate everything the flow carries rather than a one-word summary. The `label:` is what the diagram shows on the edge chip; the contract sits one click behind it (see [Labels, stacks, clusters, and groups](#labels-stacks-clusters-and-groups)).

Bodies support the same `[[Entity]]` wiki-links as entity files, and they can also link to processes, externals, and stores by name. Links open the target's dialog in place.


## Endpoints: externals, stores, processes


Every flow connects a process to something. The endpoint token's prefix says what that something is:

| Token | Endpoint |
|---|---|
| `db:<Entity>` | A data store backed by a modeled entity. Must match an entity id exactly |
| `ext:<Name>` | An external entity — an actor outside the system boundary |
| `proc:<Name>` | Another process (used for sub-DFD boundary flows) |
| `cache:` `queue:` `file:` `doc:` `manual:` `other:` | A non-entity data store of that kind |

This prefix set is closed. A store that fits none of the named kinds is authored as `other:<name>` — there is no way to invent a new prefix. A bare, unprefixed name resolves only when it is unambiguous across all namespaces; otherwise the `flow.ambiguous_endpoint` rule asks you to qualify it.

`cluster:<slug>` is the one exception: it is intercepted and expanded before endpoint parsing ever runs, so it never competes with the closed set above. See [Labels, stacks, clusters, and groups](#labels-stacks-clusters-and-groups).


### Externals


An external is described once in `externals/<Name>.md` at the model root with an `external:` label in frontmatter, an optional one-line `description:` that becomes its row in the `externals/` router, and a body covering its role, what it does, and what it expects back. Every diagram at any nesting depth can reference `ext:<Name>` — there is no per-DFD override.


### Stores


A `db:` store needs no extra file — it *is* the entity, documented in the entity's own `.md`. A non-`db` store exists simply by being referenced; an optional `stores/<name>.md` file at the model root adds a `kind:`, an optional `title:` display override, an optional `description:` for the `stores/` router, and a body explaining why the store exists:

```markdown
---
kind: file
title: Payment Gateway Log
description: Raw gateway responses kept for reconciliation and disputes, never read in normal processing.
---

Append-only log of raw gateway responses. Used for reconciliation and dispute
resolution; never read back during normal processing. Retained for 7 years.
```

Store kinds also drive each node's color in the diagram — theme-aware and overridable under `theme.flowKinds` in `ignatius.yml` (see [Themes and branding](themes-and-branding.md)). The full kind vocabulary is in the [glossary](../glossary.md).


## Sub-DFDs


A process decomposes by placing a folder with the process's exact file name next to its file. The folder holds the child diagram — its own process files, numbered locally, with full dotted numbers (`1.1`, `1.2`) composed from the nesting. Decomposition recurses as deep as it needs to — there is no depth cap. Dotted numbers compose to full depth at every level: a process four layers down reads something like `1.4.2.1`, with the full ancestor chain preserved automatically.

The child diagram must be *balanced* with its parent: the data crossing the sub-DFD's boundary has to match the parent process's declared `inputs:` and `outputs:`, column for column on `db:` flows. The `flow.unbalanced_decomposition` rule checks this at every level. In the viewer, a process with a sub-DFD renders with a stacked-shadow affordance; clicking through drills down, and a breadcrumb trail leads back up.


## Labels, stacks, clusters, and groups


A process that touches many stores draws one edge per store, and by default each edge chip previews the store's column list. That is useful for one or two edges, unreadable across a dozen. Two features address the density: a prose `label:` that replaces the column preview on any edge, and a stacking system that draws a process's stores as one shape instead of many.


### Labels and the contract dialog


Any input or output entry may carry a `label:`, a short prose name for the flow, shown on the edge chip in place of the column-list preview. One line per `, `-separated item. An empty or whitespace-only `label:` counts as absent, and the chip falls back to today's column preview under the 22-character inline gate. `data:` is unchanged either way: it is still the flow's contract and still validated (`flow.unknown_attribute`).

```yaml
outputs:
  - to: db:AuthEvent_AddRole
    label: new auth event
    data: [auth_event_id, app_user_id, role_id]
```

Clicking any chip that carries data opens a contract dialog: a table of group, store, column, and type (group is the entity's group badge, blank when none), sorted by store then by the entity's own column order. The dialog header shows the route (source → target). An `ext:` edge has no group, store, or type to show, so its dialog is a one-column table of the label lines instead. Hovering an edge still shows the existing tooltip; on a stack edge the tooltip lists one `Store: col, col` line per member.


### Clusters: naming a set of stores as one thing


A cluster is a file in `clusters/<slug>.md` at the model root, beside `externals/` and `stores/`. It names a set of entities and explains why they belong together:

```markdown
---
label: Role grants
entities:
  - AppUser_Role
  - AUR_Action
  - AUR_CommunityAction
---

What a user holds once a role is granted: the role itself, its actions, and its
community-scoped actions. Written together, never separately.
```

A process entry can reference the cluster directly with a `cluster:` token instead of separate `db:` entries. `data:` becomes a map from member entity id to its column list, plus an optional `label:` for the chip:

```yaml
outputs:
  - to: cluster:role-grants
    label: added role
    data:
      AppUser_Role: [app_user_id, role_id]
      AUR_Action: [app_user_id, role_id, action_id]
      AUR_CommunityAction: [app_user_id, role_id, community_action_id]
```

The token is sugar: at parse time it expands into one `db:` edge per mapped member, tagged with the cluster. Fingerprints, balancing, usage indexes, and examples all see the expanded `db:` edges and are unaffected: a diagram authored with the token and the same diagram authored with plain `db:` entries share a fingerprint. `cluster:` is the one exception carved out of the closed endpoint-prefix set: it is intercepted before ordinary endpoint parsing, so the rest of that set stays closed.

A cluster is not the only way to group stores. A subtype family declared in the entity model's `subtypes:` frontmatter needs no `clusters/` file at all: a process that reads a basetype and its subtypes groups automatically at the clusters or groups collapse level. A **group** is a different, coarser thing: the ERD bucket from `groups/<name>.md`. A group can hold several clusters, and the entity's existing `group:` field is what the groups collapse level groups by.


### Two views: per-process and connected


The view is a single global setting, persisted in `localStorage` under `ignatius-flow-view` and deep-linked as `flowview=` in the hash beside `dfd=`; it is restored on Back/Forward.

- **Per-process view (default).** Each process draws one read stack above it and one write stack below it, built from the stores it touches in that direction. A store set of two or more members becomes a stack; a single store stays a plain box. Two processes with the identical store set share one stack. A shared store repeats in every stack it belongs to by design here, so the duplicate marker is not drawn in this view (see the connected view below, where a duplicate is the exception). Externals are unaffected: still one source copy and one sink copy per diagram.
- **Connected view.** One node per store, grouped per process and direction, in this order: explicit `cluster:` entries (any member count), author clusters (two or more members touched by that process), subtype families from `subtypes:` (two or more), entity groups from `group:` (only at the groups collapse level, two or more), then adjacency. A store grouped for one process and touched alone by a different process renders a plain, duplicate-marked copy for that second process.

Adjacency groups stores wired to the same processes in the same directions, on by default; switch it off with `flow_view: { adjacency_stacks: false }` in `ignatius.yml`.


### Collapse level: what a stack row stands for


The collapse level is a second global setting (`localStorage` key `ignatius-flow-collapse`, hash param `collapse=`, default `clusters`). It decides what one row of a stack represents:

| Level | A stack row is |
|---|---|
| `stores` | one table |
| `clusters` | one author cluster or subtype family with two or more members in the stack, then loose tables |
| `groups` | one group with two or more members (containing its cluster rows and tables), then clusters spanning two groups, then loose tables |

A lone table is a table row at every level.


### Stacks and the stack dialog


A stack draws visible rows: store rows carry their own D# cap; cluster and subtype rows cap with `C`, group rows with `G` (never a D#, since only a store row is one) alongside the label, a `(N)` count, and a peek marker meaning more sit inside. A subtype row reads the basetype name when the basetype is among the touched stores, or `<Basetype> subtypes` when it is not. An adjacency stack is labelled `N stores`, never a member's name. Every stack carries one ⓘ badge.

Clicking a stack opens the stack dialog. Its title depends on the stack's source (a cluster's `label:`, the basetype name, the group's `label:`, `N stores` for adjacency, or `Read stack` / `Write stack` for a plain per-process stack), followed by the feeding processes and the rows at the current collapse level. A row's chevron expands and collapses its member rows; opening a member opens its entity or doc dialog. An author cluster row also shows the `clusters/<slug>.md` file's body; a subtype row links the basetype; a group row shows its description; an adjacency stack lists its shared readers and writers.

Stack edge chips show the members' authored labels one per line, then one column-preview line covering every unlabelled member; if nothing is labelled, one preview line for the whole stack. The viewer reserves each chip's rendered height plus 20px above and below between the process and store bands, so multi-line labels do not cover either box. Drag a chip to slide it along its routed edge; the point you grab stays under the pointer instead of snapping the chip's centre to it. Drag positions are saved per view, so a drag in the per-process view never applies to the connected view.


### Controls


The Flows FAB menu carries three flow-specific controls: a view item labelled by its destination (`Connected view` when you're in per-process, `Per-process view` when you're in connected), a collapse item worded as an action (`Collapse to clusters`, `Collapse to groups`, `Expand to stores`), and `Copy link`.


## Viewing flows


`ignatius serve` shows flows in the **Flows** view (`#view=flow`); the active diagram is deep-linkable via the `dfd=` hash parameter and survives refresh, alongside `flowview=` and `collapse=` for the view and collapse-level settings above. `ignatius export` includes the Flows view in the same single HTML file. Every node carries a ⓘ badge: a `db:` store opens the rich entity dialog, everything else opens its markdown doc. The process dictionary — every process, external, and store with its body and IO tables — is fused into the **Dictionary** view, searchable alongside the entities.

`ignatius validate` checks flows whenever a `flows/` directory exists, with seventeen `flow.*` rules covering unknown references, column contracts, connection shape, numbering, decomposition balance, and cluster references. See [Validation and findings](validation.md#flow-rules) for the catalog. One rule is configurable: direct process-to-process flows warn by default and can be silenced with `flow_rules: { process_to_process: false }` in `ignatius.yml`.

Hovering a data flow edge that carries data (the arrow between two nodes) reveals a styled tooltip listing the full data carried across it, under a `source → target` header. This includes the complete contents of `db:` column lists that are otherwise abbreviated on the canvas when they exceed the inline-label length limit. The tooltip is positioned fixed to the viewport and remains legible at any zoom level. Long data labels (more than 22 characters) show a truncated `…` preview on the canvas — the first ~22 characters followed by `…` — so you can always see at a glance which edges carry hidden data; the full contents are revealed on hover. An authored `label:` replaces this preview outright, on a plain edge and on a stack edge alike.


## Authoring with the skill


The [`ignatius-modeling` skill](modeling-skill.md) has two modes for flows: `/ignatius-modeling flow` walks you through authoring a diagram step by step when you already know your processes, and `/ignatius-modeling discover` interviews you about how the business runs and generates both the entities and the flows, with examples. Both verify their output with `ignatius validate`.
