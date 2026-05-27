---
entity: Subscription
classification: Independent
group: catalog
pk:
  - subscription_id
columns:
  subscription_id:
    type: integer
  sku:
    type: text
  name:
    type: text
  period_unit:
    type: text
  list_price:
    type: decimal
ak:
  - rule: unique subscription code
    columns:
      - sku
---

# Subscription

A sellable recurring service with a billing period

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | subscription_id | integer | PK | No |  |
| 2 | sku | text |  | No |  |
| 3 | name | text | — | No |  |
| 4 | period_unit | text | — | No |  |
| 5 | list_price | decimal | — | No |  |
