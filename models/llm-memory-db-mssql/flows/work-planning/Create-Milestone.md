---
process: Create Milestone
number: 1
inputs:
  - from: ext:LLM-Agent
    data: new milestone (title, content, reason, provenance project)
outputs:
  - to: db:Milestone
    data: [tracking_status, relevance_status, provenance_id, agent_id, title, content, reason]
  - to: ext:LLM-Agent
    data: newly assigned milestone_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Request to plan a new spotlight-grid milestone
      rows:
        - { title: "Ship spotlight grid", content: "Implement the DD browse-lens spotlight grid with entity and flow-node cards, hover/pin spotlight, SVG leader lines, off-screen chips, and focus mode.", reason: "Feature spec dd-spotlight-grid approved — begin implementation.", provenance_project: 100 }
  out:
    - to: db:Milestone
      label: Persisted milestone row
      rows:
        - { tracking_status: not-started, relevance_status: active, provenance_id: 100, agent_id: 1, title: "Ship spotlight grid", content: "Implement the DD browse-lens spotlight grid with entity and flow-node cards, hover/pin spotlight, SVG leader lines, off-screen chips, and focus mode.", reason: "Feature spec dd-spotlight-grid approved — begin implementation." }
    - to: ext:LLM-Agent
      label: Confirmation with new identity
      rows:
        - { milestone_id: 9001 }
---

Creates a new [[Milestone]] representing a unit of planned work for the [[LLM-Agent]].

The milestone is created with `tracking_status = 'not-started'` and `relevance_status = 'active'`. The `provenance_id` links the milestone back to the project or source that motivated it — allowing the agent to trace which project drove a particular plan. The `agent_id` records which agent instance created the record.

No [[Task]]s are created here; tasks are added in a subsequent [[Create-Task]] step. The newly generated `milestone_id` is returned immediately so the agent can begin attaching tasks without a lookup round-trip.
