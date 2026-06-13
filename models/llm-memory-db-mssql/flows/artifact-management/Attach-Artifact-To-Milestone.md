---
process: Attach Artifact To Milestone
number: 2
inputs:
  - from: ext:LLM-Agent
    data: artifact_id, milestone_id
  - from: db:Milestone_Artifact
    data: [milestone_id, artifact_id]
outputs:
  - to: db:Milestone_Artifact
    data: [milestone_id, artifact_id]
  - to: ext:LLM-Agent
    data: link confirmation
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent links screenshot artifact to milestone
      rows:
        - { artifact_id: 3001, milestone_id: 9001 }
    - from: db:Milestone_Artifact
      label: Idempotency check — existing link (if any)
      rows:
        - { milestone_id: 9001, artifact_id: 3001 }
  out:
    - to: db:Milestone_Artifact
      label: Link upserted (no duplicate created)
      rows:
        - { milestone_id: 9001, artifact_id: 3001 }
    - to: ext:LLM-Agent
      label: Confirmation of link existence
      rows:
        - { milestone_id: 9001, artifact_id: 3001, status: "linked" }
---

The [[LLM-Agent]] declares that an [[Artifact]] belongs to a given [[Milestone]]. Before inserting, the process checks [[Milestone_Artifact]] for an existing `(milestone_id, artifact_id)` pair. If the row already exists the operation is a no-op; otherwise the link row is inserted. Either way the caller receives confirmation that the link is in place.

This idempotent design allows agents to re-assert ownership after a retry or restart without creating duplicate associations. `created_at` is set only on first insert and is never updated on re-assertion.
