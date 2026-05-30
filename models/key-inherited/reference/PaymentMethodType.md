---
entity: PaymentMethodType
reference: true
group: reference
pk:
  - code
columns:
  code:
    type: text
    desc: "Enumerable code value (CREDIT_CARD, BANK_TRANSFER, CHECK)."
  description:
    type: text
    desc: "Human-readable label for the code."
---

# PaymentMethodType

A **PaymentMethodType** is the enumerable category of a payment method — credit card, bank transfer, or check. It lets the business group and reason about methods (settlement timing, fees, risk) without hard-coding those categories into application logic.

As a reference table, the categories are seed data: stable codes other entities point at, extendable without a schema change.
