---
entity: SalesOrder
classification: Dependent
group: transactional
pk:
  - party_id
  - sales_order_id
columns:
  party_id:
    type: integer
  sales_order_id:
    type: integer
  ordered_at:
    type: datetime
  total:
    type: decimal
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is placed by
---

# SalesOrder

An order placed by a Party for products or subscriptions

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |
| 2 | sales_order_id | integer | PK | No |  |
| 3 | ordered_at | datetime | — | No | Default: now |
| 4 | total | decimal | — | No |  |

## Constraints

- **sales order total reconciles to lines**: Order total must equal sum(SO_Line.qty * SO_Line.unit_price) for matching party_id and sales_order_id
  - Spans: SO_Line
