---
process: Issue Invoice
number: 2
inputs:
  - from: db:SalesOrder
    data: [party_id, sales_order_id, total]
outputs:
  - to: db:SalesInvoice
    data: [party_id, sales_invoice_id, issued_at, total]
  - to: ext:Customer
    data: invoice
---

Bills a placed order by issuing a `SalesInvoice`.

Reads the order header (`party_id`, `sales_order_id`, `total`) and writes
an invoice whose `total` carries the order total forward; `issued_at`
defaults to now. The rendered invoice is handed back to the `Customer`.

Kept deliberately simple for the demo: a real implementation would also
read `SO_Line` to itemise the invoice. Note this flow has both an input
and an output — a process with only one or the other is a *black hole* or
*miracle* and `ignatius` would flag it (`flow.process_no_output` /
`flow.process_no_input`).
