---
entity: Subscription
group: catalog
pk:
  - id
columns:
  id:
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
