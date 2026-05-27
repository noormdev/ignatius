---
entity: Product
classification: Independent
group: catalog
pk:
  - product_id
columns:
  product_id:
    type: integer
  sku:
    type: text
  name:
    type: text
  list_price:
    type: decimal
ak:
  - rule: unique product code
    columns:
      - sku
---

# Product

A sellable physical or one-time item
