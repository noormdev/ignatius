---
entity: SalesInvoice
group: transactional
pk:
  - party_id
  - sales_invoice_id
columns:
  party_id:
    type: integer
  sales_invoice_id:
    type: integer
  issued_at:
    type: datetime
    default: now
  total:
    type: decimal
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: is owed by
---

# SalesInvoice

An invoice issued to a Party for outstanding amounts

## Constraints

- **sales invoice total reconciles to lines**: Invoice total must equal sum(SI_Line.qty * SI_Line.unit_price) for matching party_id and sales_invoice_id
  - Spans: SI_Line
