---
entity: SalesInvoice
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  party_id:
    type: integer
  issued_at:
    type: datetime
  total:
    type: decimal
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is owed by
---

# SalesInvoice

An invoice issued to a Party for outstanding amounts
