## Flow reference templates

Templates for the three DFD node files: process, external entity, and non-`db` data store.
Frontmatter keys and endpoint tokens match the shipped flow format.

Endpoint tokens used in `inputs:`/`outputs:`/`examples:`:

- `db:<Entity>` — an existing ERD entity acting as a data store. Its `data:` is the entity's columns.
- `ext:<Name>` — an external entity defined at `externals/<Name>.md` (model root).
- `<kind>:<slug>` — a non-`db` store (`cache`/`queue`/`file`/`doc`/`manual`/`other`), defined at
  `stores/<slug>.md` (model root). The token's prefix is the store's `kind:`. This prefix set is
  closed — a kind outside it is authored as `kind: other` with a `title:`.
- `cluster:<slug>` — a named set of entities from `clusters/<slug>.md` (model root). The one
  exception to the closed prefix set above: it is intercepted and expanded into per-member `db:`
  edges before ordinary endpoint parsing runs. The normal shape for two or more stores a
  process treats as one thing (Step F4a in `references/dfd-authoring.md`).

Every entry carries a `label:`, the prose name the diagram shows (Step F5). The `data:` stays
the validated contract behind it.

### Process `.md` template

```markdown
---
process: <Imperative Verb Phrase>   # e.g. Collect Payment
number: <n>                         # process id within the diagram
description: "<one-line description — the router table's payload>"
inputs:
  - from: ext:<Name>
    label: <prose name for the flow>  # every entry carries one
    data: <full payload phrase>     # name every field that crosses
  - from: db:<Entity>
    label: <prose name for the flow>
    data: [<col>, <col>, <col>]     # exact entity columns read
outputs:
  - to: cluster:<slug>              # stores written as one thing (Step F4a)
    label: <prose name for the flow>
    data:
      <Entity>: [<col>, <col>]      # one member per line, columns checked per entity
      <Entity>: [<col>, <col>]
  - to: db:<Entity>                 # a store that stands alone
    label: <prose name for the flow>
    data: [<col>, <col>]            # exact entity columns written
  - to: <kind>:<slug>
    label: <prose name for the flow>
    data: <full payload phrase>
examples:                           # always present — never omit
  in:
    - from: ext:<Name>
      label: <what this input is>
      rows:
        - { <field>: <value>, <field>: <value> }
    - from: db:<Entity>
      label: <what this input is>
      rows:
        - { <col>: <value>, <col>: <value> }
  out:
    - to: db:<Entity>               # a cluster member is keyed by its own db: token here
      label: <what this output is>
      rows:
        - { <col>: <value>, <col>: <value> }
---

<What the process does and why, in business terms. What it reads and what that
tells it; what it writes and the rules on those writes; the reason for any
structural complexity. Link entities and other nodes with [[wiki-links]].>
```

Worked example — a process reading from and writing to a mix of `ext:`, `cluster:`, `db:`,
and `file:`, with a `label:` on every entry and seeded examples (the demo `Collect-Payment.md`,
its two settlement stores written as one cluster; the cluster file follows):

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

The cluster it writes, `clusters/settlement.md`:

```markdown
---
label: Settlement
entities:
  - Payment
  - PaymentAllocation
---

A payment and the invoice lines it is applied to. [[Payment]] is the money
received; [[PaymentAllocation]] says which lines it settles. Collect Payment
writes both in one transaction; neither is meaningful alone.
```

On the diagram the write side of Collect Payment is one stack: a `Settlement (2)` row with the
`C` cap, then the gateway log's own `D#` row. The one edge into that stack carries a chip of
two lines, `settled payment` over `gateway response`, one authored label per line.

### External entity `.md` template

Lives at `externals/<Name>.md` (model root). Defined once; referenced by `ext:<Name>` from any
diagram at any depth. The body is required and should be rich — paint the actor's full
relationship with the business.

```markdown
---
external: <Name>
description: "<one-line description — the router table's payload>"
# title: <Display Label>   # optional; omit to derive the label from the name
---

<Role: who this actor is, how they relate to the business, and how they differ
from any entity that records them — e.g. Customer the actor vs [[Party]] the
stored record.>

## What <Name> does

- **<Interaction>.** <What they send in / receive back.>
- **<Interaction>.** <...>

## Notes

- <What this actor expects from the business, and any context that paints the
  full picture of why they interact with it.>
```

Worked example (the demo `Customer.md`, abbreviated):

```markdown
---
external: Customer
---

The buyer who places orders and settles invoices. Modelled as an external entity
(the actor who *initiates* and *receives* requests), distinct from the [[Party]]
data store that *records* who they are.

## What Customer does

- **Places an order.** Sends an order request (party + line details) into the flow.
- **Provides payment details.** Supplies a card/account used when collecting payment.
- **Receives a receipt.** Gets confirmation once payment is collected.

## Notes

- Customer is an *actor*, never a data store. What persists about them lives in
  [[Party]] and the related order/payment stores.
```

### Non-`db` data store `.md` template

Lives at `stores/<slug>.md` (model root). The `kind:` sets the store's color and marker.
Body is required: state why the store exists and show sample values.

```markdown
---
kind: <cache|queue|file|doc|manual|other>
title: <Display Label>   # optional; omit to derive from the slug
description: "<one-line description — the router table's payload>"
---

<Why this store exists — the reason it is a resting place distinct from the
entities around it. What writes to it, what reads from it, and any retention or
compliance rule.>

## Sample values

| <field> | <field> | <field> |
|---------|---------|---------|
| <value> | <value> | <value> |
```

Worked example (the demo `gateway-log.md`, with sample values added):

```markdown
---
kind: file
title: Payment Gateway Log
---

Append-only log of raw payment-gateway responses written by the Collect Payment
process. Records the gateway transaction reference, HTTP status, and raw response
payload. Used for reconciliation and dispute resolution; never read back during
normal processing. Retained 7 years per PCI-DSS Requirement 10.3 — opaque blobs,
not structured relational data, which is why it is a `file` store and not an entity.

## Sample values

| txn_ref        | http_status | response             |
|----------------|-------------|----------------------|
| ch_3Nk9c2x1    | 200         | {"status":"captured"}|
| ch_3Nk9c2x2    | 402         | {"error":"declined"} |
```

### Cluster `.md` template

Lives at `clusters/<slug>.md` (model root). Names a set of entities a process treats as one
thing; referenced with `cluster:<slug>` from any process's `inputs:`/`outputs:` on any diagram.
When to write one, and the rules it follows (two or more existing members, one cluster per
entity, `db:` entities only), are in Step F4a of `references/dfd-authoring.md`.

```markdown
---
label: <Cluster label>              # sentence case; the row text beside the C cap
entities:
  - <Entity>
  - <Entity>
---

<Why these entities belong together: the reason a process treats them as one thing,
with the members as [[wiki-links]].>
```

Worked example (the demo `role-grants.md`):

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

Referencing it from a process: `data:` becomes a map from member entity id to its column list,
and `label:` names the flow on the chip (without one the chip reads the cluster's `label:`).

```yaml
outputs:
  - to: cluster:role-grants
    label: added role
    data:
      AppUser_Role: [app_user_id, role_id]
      AUR_Action: [app_user_id, role_id, action_id]
      AUR_CommunityAction: [app_user_id, role_id, community_action_id]
```

Each column in the map is checked against its entity (`flow.unknown_attribute`), a member key
not in the cluster's `entities:` fires `flow.cluster_member_unknown`, an empty `data:` map fires
`flow.cluster_no_members`, and a slug with no file fires `flow.unknown_cluster`. A member the
cluster file lists but the map omits is simply not part of this flow. Examples for the entry
are keyed by member `db:` token (`to: db:AppUser_Role`), never by the cluster.

---
