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
    desc: "Order total; reconciles to the sum of its line items."
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is placed by
---

# SalesOrder

A **SalesOrder** is an order a Party places for products or subscriptions. It is the commitment to buy — the record of intent that precedes invoicing and fulfillment.

It is kept separate from the invoice because ordering and billing are different moments: an order may be partially invoiced, span multiple invoices, or be amended before anything is owed.

## Business rules

- **Total reconciles to its lines** — the order total must equal the sum of `qty × unit_price` across its `SO_Line` rows.
