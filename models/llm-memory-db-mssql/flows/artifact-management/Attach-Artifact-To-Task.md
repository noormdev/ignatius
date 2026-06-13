---
process: Attach Artifact To Task
number: 3
inputs:
  - from: ext:LLM-Agent
    data: artifact_id, milestone_id, task_no
  - from: db:Task_Artifact
    data: [milestone_id, task_no, artifact_id]
outputs:
  - to: db:Task_Artifact
    data: [milestone_id, task_no, artifact_id]
  - to: ext:LLM-Agent
    data: link confirmation
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent links perf report to task (9001, 1)
      rows:
        - { artifact_id: 3002, milestone_id: 9001, task_no: 1 }
    - from: db:Task_Artifact
      label: Idempotency check — existing link (if any)
      rows:
        - { milestone_id: 9001, task_no: 1, artifact_id: 3002 }
  out:
    - to: db:Task_Artifact
      label: Link upserted (no duplicate created)
      rows:
        - { milestone_id: 9001, task_no: 1, artifact_id: 3002 }
    - to: ext:LLM-Agent
      label: Confirmation of link existence
      rows:
        - { milestone_id: 9001, task_no: 1, artifact_id: 3002, status: "linked" }
---

The [[LLM-Agent]] associates an [[Artifact]] with a specific task within a [[Milestone]]. The composite key `(milestone_id, task_no, artifact_id)` is checked in [[Task_Artifact]] before inserting; if it is already present the insert is skipped and the existing row is treated as the authoritative link.

Tasks are identified by the compound key `(milestone_id, task_no)` — `task_no` is a position number scoped to its milestone, not a global identifier. An artifact may be linked to multiple tasks (or to the milestone directly via [[Milestone_Artifact]]) without conflict.
