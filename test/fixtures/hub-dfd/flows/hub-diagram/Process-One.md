---
process: Process One
number: 1
inputs:
  - from: db:HubStoreA
    label: hub id
    data: [id]
  - from: db:HubStoreB
    label: hub id
    data: [id]
  - from: db:RecordBase
    label: base id
    data: [id]
  - from: db:RecordTypeA
    label: type a id
    data: [id]
  - from: db:RecordTypeB
    label: type b id
    data: [id]
outputs:
  - to: ext:Downstream
    label: status
    data: status
---

Reads both hubs plus the full RecordBase subtype family.
