---
process: Create Artifact
number: 1
inputs:
  - from: ext:LLM-Agent
    data: title, description, filepath, reason, provenance project
outputs:
  - to: db:Artifact
    data: [relevance_status, provenance_id, agent_id, title, description, filepath, reason]
  - to: ext:LLM-Agent
    data: new artifact_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Agent registers a new screenshot artifact
      rows:
        - { title: "spotlight-overlay.png", description: "Screenshot of spotlight overlay in browse lens", filepath: "docs/research/spotlight-overlay.png", reason: "Visual reference for DD spotlight grid implementation", provenance_project: 100 }
  out:
    - to: db:Artifact
      label: Artifact row inserted with active status
      rows:
        - { artifact_id: 3001, relevance_status: "active", provenance_id: 100, agent_id: 1, title: "spotlight-overlay.png", description: "Screenshot of spotlight overlay in browse lens", filepath: "docs/research/spotlight-overlay.png", reason: "Visual reference for DD spotlight grid implementation" }
    - to: ext:LLM-Agent
      label: New artifact_id returned to caller
      rows:
        - { artifact_id: 3001 }
---

The [[LLM-Agent]] submits metadata for a file it has produced — a screenshot, report, or generated document. The process mints a new [[Artifact]] record, sets `relevance_status` to `active`, binds the agent identity and provenance project, and returns the assigned `artifact_id` so the caller can immediately link the artifact to a [[Milestone]] or [[Task]].

Provenance project resolves to `provenance_id` on the artifact row, anchoring the artifact to the originating project context. No transition is journaled at creation — the initial `active` status is the baseline, not a state change.
