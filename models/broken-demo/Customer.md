---
entity: Customer
group: core
pk:
  - customer_id
columns:
  customer_id:
    type: integer
    desc: "Stable surrogate key."
  email:
    type: text
    desc: "Customer's email address."
  name:
    type: text
    desc: "Customer's display name."
---

**Customer** — clean baseline entity. Nothing wrong here. The validator should produce zero findings against this row, so it makes a good visual contrast against the broken entities below.
