---
entity: SIL_Product
group: transactional
pk:
  - party_id
  - sales_invoice_id
  - line_seq
columns:
  party_id:
    type: integer
    desc: "Billed party — foreign key."
  sales_invoice_id:
    type: integer
    desc: "Parent invoice — foreign key."
  line_seq:
    type: integer
    desc: "Sequence number within the invoice."
  product_id:
    type: integer
    desc: "Product billed on this line — foreign key to Product."
examples:
  - party_id: 2
    sales_invoice_id: 5001
    line_seq: 1
    product_id: 10
  - party_id: 3
    sales_invoice_id: 5003
    line_seq: 1
    product_id: 11
relationships:
  - target: SI_Line
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
      line_seq: line_seq
    predicate: { fwd: is realized as, rev: is a }
  - target: Product
    on:
      product_id: product_id
    predicate: { fwd: is billed via, rev: bills }
---

# SIL_Product

A **SIL_Product** is a SalesInvoice line that resolves to a specific `Product`. It is the product specialization of `SI_Line`, present only when the line bills a one-time product.

It records which catalog product the charge is for, tying the billed amount back to the thing that was sold.
