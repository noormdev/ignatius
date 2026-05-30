---
entity: SIL_Product
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  si_line_id:
    type: integer
    desc: "Parent invoice line — foreign key to SI_Line."
  product_id:
    type: integer
    desc: "Product billed on this line — foreign key to Product."
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

A **SIL_Product** is a SalesInvoice line that resolves to a specific `Product`. It is the product specialization of `SI_Line`, present only when the line bills a one-time product.

It records which catalog product the charge is for, tying the billed amount back to the thing that was sold.
