---
entity: RecordBase
group: records
pk:
  - id
columns:
  id:
    type: integer
subtypes:
  - exclusive: false
    desc: RecordTypeA and RecordTypeB share the RecordBase identity spine.
    members:
      - RecordTypeA
      - RecordTypeB
---

RecordBase.
