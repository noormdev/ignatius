---
process: Decompose
number: 6
inputs:
  - from: ext:Shopper
    data: order request
  - from: db:Party
    data: [party_id]
outputs:
  - to: db:SalesOrder
    data: [order_id]
---

Decompose: parent process. Its sub-DFD (Decompose/ folder) uses different
boundary columns than declared here → fires unbalanced_decomposition.
