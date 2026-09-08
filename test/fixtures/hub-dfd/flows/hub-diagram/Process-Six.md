---
process: Process Six
number: 6
inputs:
  - from: db:HubStoreA
    label: hub id
    data: [id]
  - from: db:HubStoreB
    label: hub id
    data: [id]
  - from: db:PrivateStore6Read
    label: private read
    data: [id]
outputs:
  - to: db:PrivateStore6Write
    label: private write
    data: [id]
---

Reads both hubs plus its own private store; writes its own private store.
