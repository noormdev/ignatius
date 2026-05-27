---
entity: SalesInvoice
classification: Dependent
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
  total:
    type: decimal
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is owed by
---

# SalesInvoice

An invoice issued to a Party for outstanding amounts

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |
| 2 | sales_invoice_id | integer | PK | No |  |
| 3 | issued_at | datetime | — | No | Default: now |
| 4 | total | decimal | — | No |  |

## Constraints

- **sales invoice total reconciles to lines**: Invoice total must equal sum(SI_Line.qty * SI_Line.unit_price) for matching party_id and sales_invoice_id
  - Spans: SI_Line
