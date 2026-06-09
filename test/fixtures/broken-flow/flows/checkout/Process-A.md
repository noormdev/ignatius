---
process: Process A
number: 1
inputs:
  - from: ext:Shopper
    data: order request
  - from: db:Party
    data: bogus_column
  - from: db:Party
    data: [another_bogus]
outputs:
  - to: db:GhostEntity
    data: ghost data
  - to: ext:Nobody
    data: nowhere
  - to: proc:GhostProcess
    data: lost message
  - to: proc:Process-B
    data: direct message
---

Process A: fires unknown_store (GhostEntity), unknown_external (Nobody),
unknown_process (GhostProcess), unknown_attribute (bogus_column, another_bogus),
and process_to_process (direct to Process-B).
