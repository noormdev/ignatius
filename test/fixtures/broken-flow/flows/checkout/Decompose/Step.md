---
process: Step
number: 1
inputs:
  - from: ext:Shopper
    data: order request
  - from: db:Party
    data: [type]
outputs:
  - to: db:SalesOrder
    data: [party_id]
---

Step: sub-DFD process. Boundary columns differ from parent Decompose process:
- db:Party: sub-DFD uses [type] but parent expects [party_id]
- db:SalesOrder: sub-DFD uses [party_id] but parent expects [order_id]
This mismatch fires unbalanced_decomposition.
