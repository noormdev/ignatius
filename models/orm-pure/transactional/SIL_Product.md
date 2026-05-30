---
entity: SIL_Product
group: transactional
pk:
  - id
columns:
  id:
    type: integer
  si_line_id:
    type: integer
  product_id:
    type: integer
ak:
  - rule: one SIL_Product per SI_Line
    columns:
      - si_line_id
relationships:
  - target: SI_Line
    on:
      si_line_id: id
    predicate: is a
  - target: Product
    on:
      product_id: id
    predicate: bills
---

# SIL_Product

A SalesInvoice line for a Product
