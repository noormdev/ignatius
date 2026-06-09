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
  - to: file:gateway-log
    data: gateway transaction reference, HTTP status, raw response
  - to: ext:Customer
    data: receipt
examples:
  in:
    - from: ext:Customer
      label: payment details
      rows:
        - { card: "****4242", amount: 49.99, currency: GBP }
        - { card: "****1234", amount: 199.00, currency: USD }
    - from: db:PaymentMethod
      label: stored card lookup
      rows:
        - { party_id: 1001, payment_method_id: 42, type: card, label: "Visa ending 4242" }
  out:
    - to: db:Payment
      label: settled payment record
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, amount: 49.99 }
        - { party_id: 1002, payment_method_id: 17, payment_id: 9002, amount: 199.00 }
    - to: ext:Customer
      label: receipt
      rows:
        - { payment_id: 9001, status: captured, message: "Payment accepted" }
---

Settles an invoice by recording a [[Payment]] and allocating it.

Reads the customer's stored [[PaymentMethod]] (its `type` and `label`, e.g.
"Visa ending 4242"), records the `Payment` (`amount` must be positive),
then writes a [[PaymentAllocation]] linking that payment to the invoice line
it settles. A receipt is returned to the [[Customer]].

This process is the reason `PaymentAllocation` is a five-part key: the
allocation is uniquely identified by the paying party, the method, the
payment, and the specific invoice line — every column this flow writes is
part of that key.
