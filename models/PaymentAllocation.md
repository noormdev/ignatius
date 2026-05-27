---
entity: PaymentAllocation
classification: Associative
group: transactional
pk:
  - party_id
  - payment_method_id
  - payment_id
  - sales_invoice_id
  - line_seq
columns:
  party_id:
    type: integer
  payment_method_id:
    type: integer
  payment_id:
    type: integer
  sales_invoice_id:
    type: integer
  line_seq:
    type: integer
  amount:
    type: decimal
relationships:
  - target: Payment
    identifying: true
    on:
      party_id: party_id
      payment_method_id: payment_method_id
      payment_id: payment_id
    predicate: is paid by
  - target: SI_Line
    identifying: true
    on:
      party_id: party_id
      sales_invoice_id: sales_invoice_id
      line_seq: line_seq
    predicate: settles
---

# PaymentAllocation

Allocation of part or all of a confirmed Payment to a specific SalesInvoice line

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → SI_Line | No |  |
| 2 | payment_method_id | integer | PK, FK → Payment | No |  |
| 3 | payment_id | integer | PK, FK → Payment | No |  |
| 4 | sales_invoice_id | integer | PK, FK → SI_Line | No |  |
| 5 | line_seq | integer | PK, FK → SI_Line | No |  |
| 6 | amount | decimal | — | No |  |

## Constraints

- **payment allocation amount positive**: Allocation amount must be greater than zero
- **payment allocation not exceeding payment**: Total allocations against a Payment cannot exceed the Payment amount
  - Spans: Payment
- **payment allocation not exceeding line**: Total allocations against an SI_Line cannot exceed the line's value
  - Spans: SI_Line
