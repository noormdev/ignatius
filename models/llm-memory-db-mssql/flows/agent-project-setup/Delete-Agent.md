---
process: Delete Agent
number: 4
inputs:
  - from: ext:LLM-Agent
    data: agent_id of the agent to be removed
  - from: db:Agent
    data: [agent_id]
outputs:
  - to: db:Project
    data: [agent_id]
  - to: db:Memory
    data: [agent_id]
  - to: db:Milestone
    data: [agent_id]
  - to: db:Agent
    data: [agent_id]
  - to: ext:LLM-Agent
    data: deletion confirmation with count of reassigned rows
examples:
  in:
    - from: ext:LLM-Agent
      label: Deregistration request for a retiring agent
      rows:
        - { agent_id: 2 }
    - from: db:Agent
      label: Agent record confirmed present before teardown begins
      rows:
        - { agent_id: 2 }
  out:
    - to: db:Project
      label: Orphaned project rows reassigned to sentinel agent
      rows:
        - { agent_id: 0 }
    - to: db:Memory
      label: Orphaned memory rows reassigned to sentinel agent
      rows:
        - { agent_id: 0 }
    - to: db:Milestone
      label: Orphaned milestone rows reassigned to sentinel agent
      rows:
        - { agent_id: 0 }
    - to: db:Agent
      label: Agent row removed after all dependents are rehomed
      rows:
        - { agent_id: 2 }
    - to: ext:LLM-Agent
      label: Confirmation including counts of rehomed rows
      rows:
        - { deleted_agent_id: 2, projects_reassigned: 3, memories_reassigned: 41, milestones_reassigned: 7 }
---

An [[LLM-Agent]] retires a registered agent identity. Because deleting the [[Agent]] row outright would orphan every [[Project]], [[Memory]], [[Milestone]], [[Task]], [[Note]], [[Tag]], [[Artifact]], and [[StateTransition]] that bears the departing `agent_id`, this process uses a **sentinel-reassignment pattern** instead of cascading deletes.

The sentinel is `Agent(agent_id = 0)` — a permanent, system-owned row representing "unowned history." Before removing the retiring agent row, this process issues `UPDATE` statements across all dependent tables, setting `agent_id = 0` on every row that referenced the departing agent. This keeps all historical records intact and queryable; they simply move from a named owner to the unowned sentinel. No data is destroyed.

The reassignment order matters: dependent tables are updated first, then the [[Agent]] row itself is deleted. The stored procedure runs this inside a single transaction so a partial failure leaves the database in a consistent state — either all dependents are rehomed and the agent is gone, or nothing changes.

After deletion the process returns the count of rows rehomed in each table so the caller can log or display the scope of the operation.
