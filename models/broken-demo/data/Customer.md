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
examples:
  - customer_id: 1
    email: "alice@example.com"
    name: "Alice Nguyen"
  - customer_id: 2
    emai: "bob@example.com"
    name: "Bob Patel"
---

**Customer** — structurally clean entity used to demonstrate the live-only `entity.example_unknown_column` rule. The columns and PK are valid; the second example row contains a typo'd key (`emai` instead of `email`) that fires the rule. Static CLI stderr suppresses the warning; live-mode `/dict` and the graph viewer surface it.
