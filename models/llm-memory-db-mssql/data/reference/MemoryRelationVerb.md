---
entity: MemoryRelationVerb
group: reference
pk:
  - verb_forward
columns:
  verb_forward:
    type: text
    desc: "Label for the directed edge read in the forward direction (from source to target memory)"
  verb_backward:
    type: text
    desc: "Label for the same edge read in the reverse direction (from target back to source)"
reference: true
examples:
  - { verb_forward: supersedes, verb_backward: superseded-by }
  - { verb_forward: supports, verb_backward: supported-by }
  - { verb_forward: contradicts, verb_backward: contradicted-by }
---

# MemoryRelationVerb

Controlled vocabulary of directed edge labels for the [[Related_Memory]] graph. Each row stores both directions of a relation so the graph can be traversed and rendered in either direction without joining a separate inverse table.
