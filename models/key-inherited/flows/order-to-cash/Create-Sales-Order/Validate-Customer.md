---
process: Validate Customer
number: 1
inputs:
  - from: ext:Customer
    data: order request
  - from: db:Party
    data: [party_id, type]
outputs:
  - to: queue:OrderIntake
    data: validated order
---

First step inside *Create Sales Order*: confirm the ordering `Party`
exists and read its `type` (`BUSINESS` vs `PERSON`) so the next step can
apply the right ordering rules.

The validated order is handed to *Record Order* through the
`queue:OrderIntake` transient store rather than passed directly. This is
deliberate: a direct process-to-process flow would trip ignatius'
`flow.process_to_process` discipline warning. Routing through a queue
keeps the hand-off visible and the diagram clean — and models reality
(intake validation and persistence are often separate workers).
