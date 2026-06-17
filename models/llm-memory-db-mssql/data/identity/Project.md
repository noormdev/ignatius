---
entity: Project
group: identity
pk:
  - project_id
columns:
  project_id:
    type: integer
    desc: "surrogate identity key assigned at creation"
  agent_id:
    type: integer
    desc: "agent that owns this project; references Agent.agent_id"
  name:
    type: text
    desc: "short display name for the project (typically matches the repository name)"
  filepath:
    type: text
    nullable: true
    desc: "absolute local path to the project's working directory on disk"
  git_repo:
    type: text
    nullable: true
    desc: "repository name used to correlate git operations and artifacts"
  main_branch:
    type: text
    nullable: true
    desc: "default branch (e.g. main, master) against which work is compared"
  git_url:
    type: text
    nullable: true
    desc: "remote URL of the repository for cloning and CI linkage"
  created_at:
    type: datetime
    default: now
    desc: "wall-clock timestamp when the project record was first created"
  updated_at:
    type: datetime
    default: now
    desc: "wall-clock timestamp of the most recent update to this record"
relationships:
  - target: Agent
    on:
      agent_id: agent_id
    predicate: { fwd: owns, rev: is owned by }
examples:
  - { project_id: 100, agent_id: 1, name: "ignatius", filepath: "/Users/alonso/projects/noorm/ignatius", git_repo: "ignatius", main_branch: "main", git_url: "https://github.com/noorm/ignatius", created_at: "2025-03-01T09:00:00", updated_at: "2026-06-13T08:00:00" }
  - { project_id: 101, agent_id: 1, name: "monorepo", filepath: "/Users/alonso/projects/monorepo", git_repo: "monorepo", main_branch: "main", git_url: "https://github.com/alonso/monorepo", created_at: "2025-04-10T11:15:00", updated_at: "2025-12-20T14:30:00" }
  - { project_id: 102, agent_id: 2, name: "hapi-api", filepath: "/Users/alonso/projects/hapi/api", git_repo: "hapi-api", main_branch: "main", git_url: "https://github.com/alonso/hapi-api", created_at: "2025-05-22T16:00:00", updated_at: "2026-01-03T10:45:00" }
---

# Project

A Project is a code repository workspace that scopes an [[Agent]]'s memories, notes, milestones, tasks, and artifacts to a specific codebase. Like [[Agent]], rows in dependent tables default their `project_id` to a sentinel value of `0` so records created before a project is registered — or after it is removed — are never orphaned.
