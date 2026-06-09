---
process: Process Payment
number: 1
inputs:
  - from: ext:Buyer
    data: payment details
outputs:
  - to: ext:Buyer
    data: receipt
---

Handles payment authorisation and confirmation.
