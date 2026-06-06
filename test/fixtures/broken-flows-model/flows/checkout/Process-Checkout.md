---
process: Process Checkout
number: 1
inputs:
  - from: ext:Buyer
    data: order details
outputs:
  - to: db:GhostEntity
    data: order record
---

This process references db:GhostEntity which does not exist in the entity catalog.
This fires flow.unknown_store (Class B) and causes exit 1.
