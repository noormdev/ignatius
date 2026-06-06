---
process: Collect Payment
number: 3
inputs:
  - from: ext:Customer
    data: payment details
  - from: db:PaymentMethod
    data: [party_id, payment_method_id, type, label]
outputs:
  - to: db:Payment
    data: [party_id, payment_method_id, payment_id, amount]
  - to: db:PaymentAllocation
    data: [party_id, payment_method_id, payment_id, sales_invoice_id, line_seq]
  - to: ext:Customer
    data: receipt
---

Settles an invoice by recording a `Payment` and allocating it.

Reads the customer's stored `PaymentMethod` (its `type` and `label`, e.g.
"Visa ending 4242"), records the `Payment` (`amount` must be positive),
then writes a `PaymentAllocation` linking that payment to the invoice line
it settles. A receipt is returned to the `Customer`.

This process is the reason `PaymentAllocation` is a five-part key: the
allocation is uniquely identified by the paying party, the method, the
payment, and the specific invoice line — every column this flow writes is
part of that key.
