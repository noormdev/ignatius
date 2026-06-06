---
process: Place Order
number: 1
inputs:
  - from: ext:Shopper
    data: order request
  - from: db:Party
    data: [party_id]
outputs:
  - to: db:Party
    data: [party_id]
  - to: cache:Sessions
    data: session token
---

Handles the full order placement flow, including identity verification and session management.
