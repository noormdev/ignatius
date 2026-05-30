---
entity: Product
group: catalog
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  sku:
    type: text
    desc: "Stock-keeping unit; unique product code."
  name:
    type: text
    desc: "Display name of the product."
  list_price:
    type: decimal
    desc: "Catalog unit price before discounts."
ak:
  - rule: unique product code
    columns:
      - sku
---

# Product

A **Product** is a sellable, one-time physical or digital item in the catalog. It is the thing an order line or invoice line points at when a customer buys something outright rather than subscribing.

It is its own entity, identified by a unique `sku`, so the catalog is the single source of truth for what can be sold and at what list price — order and invoice lines reference it rather than copying its identity.

## Business rules

- **SKU is unique** — every product has exactly one stock-keeping code.
