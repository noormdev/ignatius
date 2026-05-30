---
entity: SalesOrder
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  party_id:
    type: integer
  ordered_at:
    type: datetime
  total:
    type: decimal
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is placed by
---

# SalesOrder

An order placed by a Party for products or subscriptions
