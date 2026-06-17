# Process flows


A model can carry data flow diagrams (DFDs) alongside its entities. A DFD shows what the business *does*: numbered processes transform data, external entities send it in and receive it out, and data stores hold what persists between steps. ignatius renders them in the SSADM style with Gane-Sarson notation — open-ended `D#` store boxes, numbered process hubs, green external boxes — in the **Flows** view of the app.

The same markdown-first rule applies: flows live as `.md` files with YAML frontmatter, the diagram is generated, and a `db:` store in a flow is the *same entity* you modeled in the ERD — clicking it opens the full entity dialog with columns, relationships, and examples.


## Folder layout


Flows live in a `flows/` folder at the model root. Each diagram is a folder; each process is a file inside it.

```
models/
  ignatius.yml
  identity/ ...               # entity files, as usual
  flows/
    _externals/
      Customer.md             # shared external, usable by every diagram
    order-to-cash/
      Create-Sales-Order.md   # process 1
      Create-Sales-Order/     # same-named folder = sub-DFD of process 1
        Validate-Customer.md
        Record-Order.md
      Issue-Invoice.md        # process 2
      Collect-Payment.md      # process 3
      _stores/
        gateway-log.md        # optional description of a non-entity store
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
inputs:
  - from: ext:Customer
    data: payment details
  - from: db:PaymentMethod
    data: [party_id, payment_method_id, type, label]
outputs:
  - to: db:Payment
    data: [party_id, payment_method_id, payment_id, amount]
  - to: file:gateway-log
    data: gateway transaction reference, HTTP status, raw response
  - to: ext:Customer
    data: receipt
examples:
  in:
    - from: ext:Customer
      label: payment details
      rows:
        - { card: "****4242", amount: 49.99, currency: GBP }
  out:
    - to: db:Payment
      label: settled payment record
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, amount: 49.99 }
---

Settles an invoice by recording a [[Payment]] and allocating it against the
invoice line it pays. A receipt is returned to the [[Customer]].
```

| Field | Required | Meaning |
|---|---|---|
| `process` | yes | The human label shown on the node |
| `number` | no | Local rank among sibling processes; falls back to file order. Full SSADM numbers (`1.2.1`) are composed from the folder nesting automatically |
| `inputs` / `outputs` | yes | The flows. Each names an endpoint (`from:`/`to:`) and the `data:` it carries |
| `examples` | no | Sample in/out rows rendered as tables in the process dialog, one entry per flow |

The `data:` field is the flow's label and its contract. On a `db:` endpoint it is **always column names** — a string for one column, a list for several — and every name is checked against the entity's `pk` and `columns` (the `flow.unknown_attribute` rule). On any other endpoint it is an opaque label; make it enumerate everything the flow carries rather than a one-word summary.

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


### Externals


An external is described once in an `_externals/<Name>.md` file with an `external:` label in frontmatter and a body covering its role, what it does, and what it expects back. Declare it at `flows/_externals/` and every diagram at any nesting depth can reference `ext:<Name>`; a diagram's own `_externals/` folder overrides the shared definition for that diagram only.


### Stores


A `db:` store needs no extra file — it *is* the entity, documented in the entity's own `.md`. A non-`db` store exists simply by being referenced; an optional `_stores/<name>.md` file adds a `kind:`, an optional `title:` display override, and a body explaining why the store exists:

```markdown
---
kind: file
title: Payment Gateway Log
---

Append-only log of raw gateway responses. Used for reconciliation and dispute
resolution; never read back during normal processing. Retained for 7 years.
```

Store kinds also drive each node's color in the diagram — theme-aware and overridable under `theme.flowKinds` in `ignatius.yml` (see [Themes and branding](themes-and-branding.md)). The full kind vocabulary is in the [glossary](../glossary.md).


## Sub-DFDs


A process decomposes by placing a folder with the process's exact file name next to its file. The folder holds the child diagram — its own process files, numbered locally, with full dotted numbers (`1.1`, `1.2`) composed from the nesting. Decomposition recurses as deep as it needs to — there is no depth cap. Dotted numbers compose to full depth at every level: a process four layers down reads something like `1.4.2.1`, with the full ancestor chain preserved automatically.

The child diagram must be *balanced* with its parent: the data crossing the sub-DFD's boundary has to match the parent process's declared `inputs:` and `outputs:`, column for column on `db:` flows. The `flow.unbalanced_decomposition` rule checks this at every level. In the viewer, a process with a sub-DFD renders with a stacked-shadow affordance; clicking through drills down, and a breadcrumb trail leads back up.


## Viewing flows


`ignatius serve` shows flows in the **Flows** view (`#view=flow`); the active diagram is deep-linkable via the `dfd=` hash parameter and survives refresh. `ignatius export` includes the Flows view in the same single HTML file. Every node carries a ⓘ badge: a `db:` store opens the rich entity dialog, everything else opens its markdown doc. The process dictionary — every process, external, and store with its body and IO tables — is fused into the **Dictionary** view, searchable alongside the entities.

`ignatius validate` checks flows whenever a `flows/` directory exists, with eleven `flow.*` rules covering unknown references, column contracts, connection shape, numbering, and decomposition balance. See [Validation and findings](validation.md#flow-rules) for the catalog. One rule is configurable: direct process-to-process flows warn by default and can be silenced with `flow_rules: { process_to_process: false }` in `ignatius.yml`.

Hovering a data flow edge that carries data (the arrow between two nodes) reveals a styled tooltip listing the full data carried across it, under a `source → target` header. This includes the complete contents of `db:` column lists that are otherwise abbreviated on the canvas when they exceed the inline-label length limit. The tooltip is positioned fixed to the viewport and remains legible at any zoom level. Long data labels (more than 22 characters) show a truncated `…` preview on the canvas — the first ~22 characters followed by `…` — so you can always see at a glance which edges carry hidden data; the full contents are revealed on hover.


## Authoring with the skill


The [`noorm-modeling` skill](modeling-skill.md) has two modes for flows: `/noorm-modeling flow` walks you through authoring a diagram step by step when you already know your processes, and `/noorm-modeling discover` interviews you about how the business runs and generates both the entities and the flows, with examples. Both verify their output with `ignatius validate`.
