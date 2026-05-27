---
entity: SO_Line
classification: Basetype
group: transactional
pk:
  - party_id
  - sales_order_id
  - line_seq
columns:
  party_id:
    type: integer
  sales_order_id:
    type: integer
  line_seq:
    type: integer
  type:
    type: text
  qty:
    type: integer
  unit_price:
    type: decimal
relationships:
  - target: SalesOrder
    identifying: true
    on:
      party_id: party_id
      sales_order_id: sales_order_id
    predicate: is part of
  - target: LineItemType
    identifying: false
    on:
      type: code
    predicate: is classified by
---

# SO Line

A line item on a SalesOrder — exclusively a subscription or a product

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → SalesOrder | No |  |
| 2 | sales_order_id | integer | PK, FK → SalesOrder | No |  |
| 3 | line_seq | integer | PK | No |  |
| 4 | type | text | FK → LineItemType | No |  |
| 5 | qty | integer | — | No |  |
| 6 | unit_price | decimal | — | No |  |

## Subtypes

Each line is exactly one of: subscription or product
- **Exclusive:** Yes
- **SOL_Subscription:** type = LineItemType.code.SUBSCRIPTION
- **SOL_Product:** type = LineItemType.code.PRODUCT

## Constraints

- **sales order line qty positive**: Line quantity must be at least 1
- **sales order line price non negative**: Unit price cannot be negative
