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
    default: now
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

## Constraints

- **sales order total reconciles to lines**: Order total must equal sum(SO_Line.qty * SO_Line.unit_price) for matching party_id and sales_order_id
  - Spans: SO_Line
