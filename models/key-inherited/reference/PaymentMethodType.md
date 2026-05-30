---
entity: PaymentMethodType
reference: true
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

## Values

- `CREDIT_CARD` — Credit or debit card
- `BANK_TRANSFER` — ACH or wire transfer
- `CHECK` — Paper check
