---
entity: LineItemType
reference: true
group: reference
pk:
  - code
columns:
  code:
    type: text
    desc: "Enumerable code value (SUBSCRIPTION, PRODUCT)."
  description:
    type: text
    desc: "Human-readable label for the code."
examples:
  - code: PRODUCT
    description: One-time physical or digital product purchase
  - code: SUBSCRIPTION
    description: Recurring subscription plan billed per period
---

# LineItemType

A **LineItemType** classifies what a sales line refers to — a one-time `Product` or a recurring `Subscription`. It is the discriminator that decides which line subtype applies, so a line can never claim to be both or neither.

Modeling the kinds as a lookup table keeps the rule in the data: every `SO_Line` and `SI_Line` carries a `type` that resolves to exactly one known line kind.
