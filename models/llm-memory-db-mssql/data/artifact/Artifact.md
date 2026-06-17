---
entity: Artifact
group: artifact
pk:
  - artifact_id
columns:
  artifact_id: { type: integer, desc: "IDENTITY surrogate PK" }
  relevance_status: { type: text, desc: "Lifecycle state; FK to RelevanceStatus" }
  provenance_id: { type: integer, desc: "Project that produced this artifact; sentinel 0 = system" }
  agent_id: { type: integer, desc: "Agent that produced this artifact; sentinel 0 = system" }
  title: { type: text, desc: "Short human-readable name for the artifact" }
  description: { type: text, desc: "What the artifact contains or represents" }
  filepath: { type: text, desc: "Path to the artifact file on disk or in storage" }
  reason: { type: text, desc: "Why this artifact was created" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
  updated_at: { type: datetime, default: now, desc: "Last modification timestamp" }
relationships:
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
  - { artifact_id: 3001, relevance_status: active, provenance_id: 100, agent_id: 1, title: "spotlight-overlay.png", description: "Screenshot of spotlight overlay feature during development", filepath: "docs/research/spotlight-overlay.png", reason: "Captured for visual regression reference", created_at: "2026-06-01T10:00:00", updated_at: "2026-06-01T10:00:00" }
  - { artifact_id: 3002, relevance_status: active, provenance_id: 100, agent_id: 1, title: "perf-report.md", description: "ELK layout render latency measurement results", filepath: "tmp/perf-report.md", reason: "Document baseline before optimisation", created_at: "2026-06-02T14:30:00", updated_at: "2026-06-02T14:30:00" }
  - { artifact_id: 3003, relevance_status: archived, provenance_id: 100, agent_id: 1, title: "schema-draft-v1.sql", description: "Initial schema draft superseded by final migration", filepath: "tmp/schema-draft-v1.sql", reason: "Archive superseded design artefact", created_at: "2026-05-15T09:00:00", updated_at: "2026-06-01T08:00:00" }
---

# Artifact

A file or document produced by an [[Agent]] during work on a [[Project]] — such as a screenshot, generated report, or design draft. Artifacts are versioned through [[RelevanceStatus]] and attach to the [[Milestone]] or [[Task]] they were produced under via [[Milestone_Artifact]] and [[Task_Artifact]].
