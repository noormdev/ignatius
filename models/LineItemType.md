---
entity: LineItemType
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

# LineItemType

Whether a line item refers to a Subscription or a Product

## Attributes

| # | Attribute | Logical type | Key role | Nullable | Notes |
|---|-----------|--------------|----------|----------|-------|
| 1 | code | text | PK | No |  |
| 2 | description | text | — | No |  |

## Values

- `SUBSCRIPTION` — Recurring subscription line
- `PRODUCT` — One-time product line
