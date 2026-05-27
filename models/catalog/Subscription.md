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
