---
entity: Milestone_StateTransition
group: audit
pk:
  - transition_id
columns:
  transition_id: { type: integer, desc: "Shared PK — FK to StateTransition." }
  milestone_id: { type: integer, desc: "FK to the Milestone whose state changed." }
  created_at: { type: datetime, default: now, desc: "When this subtype row was written." }
relationships:
  - target: StateTransition
    on: { transition_id: transition_id }
    predicate: { fwd: is realized as, rev: is a }
  - target: Milestone
    on: { milestone_id: milestone_id }
    predicate: { fwd: is journaled by, rev: journals }
examples:
  - { transition_id: 8001, milestone_id: 9001 }
---

# Milestone_StateTransition

[[Milestone_StateTransition]] pins a [[StateTransition]] journal entry to the specific [[Milestone]] whose tracking or relevance status changed, covering both the `milestone-tracking` and `milestone-relevance` type codes via `fn_StateTransitionIsMilestoneAxis`.
