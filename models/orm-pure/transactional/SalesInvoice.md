---
entity: SalesInvoice
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  party_id:
    type: integer
    desc: "Billed party — foreign key to Party."
  issued_at:
    type: datetime
    desc: "Timestamp the invoice was issued."
  total:
    type: decimal
    desc: "Invoice total; reconciles to the sum of its line items."
examples:
  - id: 1
    party_id: 2
    issued_at: "2024-03-05T14:25:00Z"
    total: 138.00
  - id: 2
    party_id: 1
    issued_at: "2024-04-01T09:05:00Z"
    total: 4999.00
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is owed by
---

# SalesInvoice

A **SalesInvoice** is a bill issued to a Party for amounts owed. It is the demand for payment — the document a `Payment` is ultimately applied against, line by line.

It is its own entity, distinct from the order, because what was ordered and what is billed can diverge, and because the invoice is the anchor for the money side of the model: allocations settle invoice lines, not order lines.

## Business rules

- **Total reconciles to its lines** — the invoice total must equal the sum of `qty × unit_price` across its `SI_Line` rows.
