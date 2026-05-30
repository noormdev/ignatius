---
entity: LineItemType
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

# LineItemType

Whether a line item refers to a Subscription or a Product

## Values

- `SUBSCRIPTION` — Recurring subscription line
- `PRODUCT` — One-time product line
