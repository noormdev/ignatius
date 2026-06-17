## Flow reference templates

Templates for the three DFD node files: process, external entity, and non-`db` data store.
Frontmatter keys and endpoint tokens match the shipped flow format (`docs/spec/process-flows.md`).

Endpoint tokens used in `inputs:`/`outputs:`/`examples:`:

- `db:<Entity>` — an existing ERD entity acting as a data store. Its `data:` is the entity's columns.
- `ext:<Name>` — an external entity defined at `externals/<Name>.md` (model root).
- `<kind>:<slug>` — a non-`db` store (`cache`/`queue`/`file`/`doc`/`manual`/`other`), defined at
  `stores/<slug>.md` (model root). The token's prefix is the store's `kind:`. This prefix set is
  closed — a kind outside it is authored as `kind: other` with a `title:`.

### Process `.md` template

```markdown
---
process: <Imperative Verb Phrase>   # e.g. Collect Payment
number: <n>                         # process id within the diagram
inputs:
  - from: ext:<Name>
    data: <full payload phrase>     # name every field that crosses
  - from: db:<Entity>
    data: [<col>, <col>, <col>]     # exact entity columns read
outputs:
  - to: db:<Entity>
    data: [<col>, <col>]            # exact entity columns written
  - to: <kind>:<slug>
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
    - to: db:<Entity>
      label: <what this output is>
      rows:
        - { <col>: <value>, <col>: <value> }
---

<What the process does and why, in business terms. What it reads and what that
tells it; what it writes and the rules on those writes; the reason for any
structural complexity. Link entities and other nodes with [[wiki-links]].>
```

Worked example — a process reading from and writing to a mix of `ext:`, `db:`, and `file:`,
with seeded examples (the demo `Collect-Payment.md`):

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
    - from: db:PaymentMethod
      label: stored card lookup
      rows:
        - { party_id: 1001, payment_method_id: 42, type: card, label: "Visa ending 4242" }
  out:
    - to: db:Payment
      label: settled payment record
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, amount: 49.99 }
    - to: ext:Customer
      label: receipt
      rows:
        - { payment_id: 9001, status: captured, message: "Payment accepted" }
---

Settles an invoice by recording a [[Payment]] and allocating it.

Reads the customer's stored [[PaymentMethod]], records the `Payment` (`amount`
must be positive), and returns a receipt to the [[Customer]].
```

### External entity `.md` template

Lives at `externals/<Name>.md` (model root). Defined once; referenced by `ext:<Name>` from any
diagram at any depth. The body is required and should be rich — paint the actor's full
relationship with the business.

```markdown
---
external: <Name>
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

---
