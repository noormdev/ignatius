---
entity: Artifact_StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "Shared PK — FK to StateTransition." }
  artifact_id: { type: integer, desc: "FK to the Artifact whose relevance status changed." }
  created_at: { type: datetime, default: now, desc: "When this subtype row was written." }
relationships:
  - target: StateTransition
    on: { transition_id: transition_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Artifact
    on: { artifact_id: artifact_id }
    predicate: { fwd: is journaled by, rev: journals }
examples:
  - { transition_id: 8005, artifact_id: 3001 }
---

# Artifact_StateTransition

[[Artifact_StateTransition]] pins a [[StateTransition]] journal entry to the specific [[Artifact]] whose relevance status changed, covering the `artifact-relevance` type code.
