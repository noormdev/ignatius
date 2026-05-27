---
entity: PaymentMethodType
classification: Classifier
group: reference
pk:
  - code
columns:
  code:
    type: text
  description:
    type: text
---

# PaymentMethodType

Categorization of a PaymentMethod

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | code | text | PK | No |  |
| 2 | description | text | — | No |  |

## Values

- `CREDIT_CARD` — Credit or debit card
- `BANK_TRANSFER` — ACH or wire transfer
- `CHECK` — Paper check
