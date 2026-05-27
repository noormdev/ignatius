---
entity: PaymentMethod
classification: Dependent
group: transactional
pk:
  - party_id
  - payment_method_id
columns:
  party_id:
    type: integer
  payment_method_id:
    type: integer
  type:
    type: text
  label:
    type: text
relationships:
  - target: Party
    identifying: true
    on:
      party_id: party_id
    predicate: is held by
  - target: PaymentMethodType
    identifying: false
    on:
      type: code
    predicate: is classified by
---

# PaymentMethod

A means by which a Party can pay — card, bank account, check

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | party_id | integer | PK, FK → Party | No |  |
| 2 | payment_method_id | integer | PK | No |  |
| 3 | type | text | FK → PaymentMethodType | No |  |
| 4 | label | text | — | No |  |
