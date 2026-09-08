---
process: Collect Payment
number: 3
description: "Settles an invoice by recording a payment and allocating it against invoice lines."
inputs:
  - from: ext:Customer
    label: payment details
    data: card or account, amount, currency
  - from: db:PaymentMethod
    label: stored payment method
    data: [party_id, payment_method_id, type, label]
outputs:
  - to: cluster:settlement
    label: settled payment
    data:
      Payment: [party_id, payment_method_id, payment_id, amount]
      PaymentAllocation: [party_id, payment_method_id, payment_id, sales_invoice_id, line_seq]
  - to: file:gateway-log
    label: gateway response
    data: gateway transaction reference, HTTP status, raw response
  - to: ext:Customer
    label: receipt
    data: payment id, status, message
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
    - to: db:PaymentAllocation
      label: allocation against the invoice line
      rows:
        - { party_id: 1001, payment_method_id: 42, payment_id: 9001, sales_invoice_id: 5001, line_seq: 1 }
    - to: ext:Customer
      label: receipt
      rows:
        - { payment_id: 9001, status: captured, message: "Payment accepted" }
---

Settles an invoice by recording a [[Payment]] and allocating it.

Reads the customer's stored [[PaymentMethod]] (its `type` and `label`, e.g.
"Visa ending 4242"), records the `Payment` (`amount` must be positive),
then writes a [[PaymentAllocation]] linking that payment to the invoice line
it settles, both in one transaction. A receipt is returned to the [[Customer]].

This process is the reason `PaymentAllocation` is a five-part key: the
allocation is uniquely identified by the paying party, the method, the
payment, and the specific invoice line — every column this flow writes is
part of that key.
