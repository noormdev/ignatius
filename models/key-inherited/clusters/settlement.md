---
label: Settlement
entities:
  - Payment
  - PaymentAllocation
---

A payment and the invoice lines it is applied to. [[Payment]] is the money
received; [[PaymentAllocation]] says which lines it settles. Collect Payment
writes both in one transaction; neither is meaningful alone.
