---
process: Process B
number: 1
inputs:
  - from: proc:Process-A
    data: direct message
outputs:
  - to: ext:Shopper
    data: confirmation
---

Process B: duplicate number (same number: 1 as Process A → duplicate_number)
and receives direct from Process-A (process_to_process on the edge).
