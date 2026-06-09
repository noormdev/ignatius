---
process: Process Return
number: 1
inputs:
  - from: ext:Customer
    data: return request
  - from: db:SalesInvoice
    data: [party_id, sales_invoice_id, total]
outputs:
  - to: db:Payment
    data: [party_id, payment_method_id, payment_id, amount]
  - to: ext:Customer
    data: refund confirmation
---

Handles a customer's return request by validating the original invoice and
recording a refund `Payment`.

Reads the `SalesInvoice` (`party_id`, `sales_invoice_id`, `total`) to confirm
the sale exists and determine the refund amount. Records a new `Payment` entry
(`party_id`, `payment_method_id`, `payment_id`, `amount`) representing the
outbound refund settlement. Returns a refund confirmation to the `Customer`
once the payment record is written.

## Business rules

- **Refund cannot exceed the invoice total** — the `Payment.amount` for a
  refund must not exceed the original `SalesInvoice.total`.
- **Invoice must exist** — if `SalesInvoice` lookup returns no row, the return
  request is rejected before any `Payment` record is written.
