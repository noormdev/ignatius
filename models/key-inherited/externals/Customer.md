---
external: Customer
---

The buyer who places orders and settles invoices. Modelled as an external
entity (the actor who *initiates* and *receives* requests), distinct from the
`Party` data store that *records* who they are. The same real-world person
appears on a diagram more than once — as `Customer` (the source/sink of
requests) and, once their details are persisted, as rows in `db:Party`.

This file is the single, root-level definition of `Customer` (declared at
`flows/_externals/`). Any DFD — at any nesting depth — that references
`ext:Customer` picks up this description; it does **not** need its own
`_externals/Customer.md`. Document everything `Customer` does here, once.

## What Customer does

- **Places an order.** Sends an *order request* (party + line details) into the
  order-to-cash flow, which validates the customer and records the sales order.
- **Provides payment details.** Supplies a payment method (card / account) used
  when collecting payment.
- **Receives an invoice.** Gets the issued invoice for the goods or services.
- **Pays an invoice.** Settles the amount due; the payment is recorded and
  allocated against the invoice.
- **Receives a receipt.** Gets confirmation once payment is collected.
- **Requests a return / refund.** Initiates the refund flow for returned goods,
  and receives the refunded amount back.

## Notes

- `Customer` is an *actor*, never a data store. What gets persisted about them
  lives in `db:Party` (identity) and the related order/payment stores.
- When a process both receives from and sends to `Customer`, the diagram draws
  `Customer` twice (a source copy above, a sink copy below) — both are this same
  entity.
