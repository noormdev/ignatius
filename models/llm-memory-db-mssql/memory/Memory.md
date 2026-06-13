---
entity: Memory
group: memory
pk:
  - memory_id
columns:
  memory_id:
    type: integer
    desc: "IDENTITY surrogate primary key"
  domain:
    type: text
    desc: "Broad subject area this memory belongs to"
  category:
    type: text
    desc: "Fine-grained type of knowledge (fact, decision, convention, gotcha)"
  relevance_status:
    type: text
    desc: "Current lifecycle state of this memory (active, archived, superseded, deleted)"
  provenance_id:
    type: integer
    desc: "Project that produced this memory; sentinel 0 means no project provenance"
  agent_id:
    type: integer
    desc: "Agent that recorded this memory; sentinel 0 means system-originated"
  content:
    type: text
    desc: "The durable fact, decision, convention, or gotcha text"
  reason:
    type: text
    desc: "Explanation of why this memory was recorded"
  was_inferred:
    type: boolean
    desc: "True when the memory was derived by reasoning rather than direct observation"
  was_observed:
    type: boolean
    desc: "True when the memory was captured from direct agent observation"
  was_evidenced:
    type: boolean
    desc: "True when the memory is backed by concrete evidence or a source artifact"
  was_user_provided:
    type: boolean
    desc: "True when a human explicitly supplied this memory"
  last_accessed_at:
    type: datetime
    default: now
    desc: "Timestamp of the most recent retrieval"
  access_count:
    type: integer
    desc: "Number of times this memory has been retrieved"
  created_at:
    type: datetime
    default: now
    desc: "Timestamp when the memory was first recorded"
  updated_at:
    type: datetime
    default: now
    desc: "Timestamp of the most recent update"
relationships:
  - target: MemoryDomain
    on: { domain: domain }
    predicate: { fwd: classifies, rev: is classified by }
  - target: MemoryCategory
    on: { category: category }
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
  - { memory_id: 5001, domain: coding, category: gotcha, relevance_status: active, provenance_id: 100, agent_id: 1, content: "Bun's fs.watch on macOS coalesces rapid events into one notification — always debounce 200ms before re-parsing the model directory", reason: "Hit in live-reload server; bare watch fired once for two simultaneous file saves", was_inferred: false, was_observed: true, was_evidenced: false, was_user_provided: false, access_count: 3 }
  - { memory_id: 5002, domain: architecture, category: decision, relevance_status: active, provenance_id: 100, agent_id: 1, content: "ignatius uses a single unified SPA (serve/export) rather than separate dict/graph/flow CLI subcommands; dict, graph, and flow are removal stubs that exit 1", reason: "Simplifies the build pipeline and removes the need for three separate static generators", was_inferred: false, was_observed: false, was_evidenced: true, was_user_provided: false, access_count: 7 }
  - { memory_id: 5003, domain: preferences, category: convention, relevance_status: active, provenance_id: 0, agent_id: 1, content: "Never include AI bylines in git commit messages — always omit 'Co-Authored-By: Claude' lines", reason: "Explicit user preference stated at session start", was_inferred: false, was_observed: false, was_evidenced: false, was_user_provided: true, access_count: 12 }
---

# Memory

A durable piece of knowledge — fact, decision, convention, or gotcha — that an [[Agent]] has learned and persisted for future retrieval, classified by [[MemoryDomain]] and [[MemoryCategory]], with its lifecycle managed through [[RelevanceStatus]]. The `was_*` flags record exactly how the memory was acquired: inferred by reasoning, observed directly, backed by evidence, or supplied by a human.
