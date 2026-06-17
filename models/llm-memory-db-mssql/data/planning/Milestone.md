---
entity: Milestone
group: planning
pk:
  - milestone_id
columns:
  milestone_id: { type: integer, desc: "IDENTITY surrogate primary key" }
  tracking_status: { type: text, desc: "Workflow status of this milestone" }
  relevance_status: { type: text, desc: "Whether this milestone is active, archived, or deleted" }
  provenance_id: { type: integer, desc: "Project that originated this milestone (sentinel 0 = none)" }
  agent_id: { type: integer, desc: "Agent that recorded this milestone (sentinel 0 = system)" }
  title: { type: text, desc: "Short human-readable title" }
  content: { type: text, desc: "Full narrative body of the milestone" }
  reason: { type: text, desc: "Rationale for why this milestone was created" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
  updated_at: { type: datetime, default: now, desc: "Row last-modified timestamp" }
relationships:
  - target: TrackingStatus
    on: { tracking_status: tracking_status }
    predicate: { fwd: classifies, rev: is classified by }
  - target: RelevanceStatus
    on: { relevance_status: relevance_status }
    predicate: { fwd: classifies, rev: is classified by }
  - target: Project
    on: { provenance_id: project_id }
    predicate: { fwd: is the provenance of, rev: originates from }
  - target: Agent
    on: { agent_id: agent_id }
    predicate: { fwd: records, rev: is recorded by }
examples:
  - { milestone_id: 9001, tracking_status: done, relevance_status: active, provenance_id: 100, agent_id: 1, title: "Ship spotlight grid", content: "Implement the DD browse-lens spotlight grid feature end-to-end.", reason: "Improve dictionary navigability for large models." }
  - { milestone_id: 9002, tracking_status: in_progress, relevance_status: active, provenance_id: 100, agent_id: 1, title: "DFD polish round 4", content: "Address remaining DFD polish items CP24–CP26.", reason: "Close out process-flow quality gaps before release." }
  - { milestone_id: 9003, tracking_status: pending, relevance_status: active, provenance_id: 100, agent_id: 0, title: "Performance indexing", content: "Add O(1) model index maps and ELK worker.", reason: "Reduce render latency for large models." }
---

# Milestone

A Milestone is a tracked unit of work scoped to a [[Project]], representing a meaningful deliverable owned and recorded by an [[Agent]].
Its workflow state is classified by [[TrackingStatus]] and its retention state by [[RelevanceStatus]].
