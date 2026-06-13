---
external: LLM-Agent
title: LLM Agent
---

The AI coding agent (e.g. Claude, Cursor) that uses this database as its long-term memory. It is the *actor* that initiates every operation and consumes every result — distinct from the [[Agent]] entity, which is the stored *record* of that actor (the `agent_id` written onto every row). The agent never touches tables directly: it calls operations over an MCP (Model Context Protocol) server, which adapts each tool call into the SDK and stored-procedure layer.

## What LLM Agent does

- **Records memories.** Sends a domain/category-classified fact, decision, convention, or gotcha to be stored; receives the new `memory_id`.
- **Relates and consolidates memories.** Asserts directed links between memories and folds duplicates into a canonical memory; receives the surviving id.
- **Plans work.** Creates projects, milestones, and tasks, and advances their status through the gated state machines; receives the new ids and confirmation of each legal transition.
- **Annotates.** Attaches free-form notes to a project, milestone, or task; receives the new `note_id`.
- **Registers artifacts.** Records files it produced and links them to the milestone or task they came from.
- **Organizes with tags.** Creates reusable labels and attaches or bulk-attaches them across memories and other entities; merges duplicate tags.
- **Retrieves.** Queries active memories — including ranked tag-intersection search — and reads the audit history of status changes.

## Notes

- The agent is an *actor*, never a data store. Everything that persists about it lives in the [[Agent]] entity and the rows it owns.
- Every write carries the agent's `agent_id` as provenance; on agent deletion those rows are reassigned to the sentinel `Agent(0)` rather than lost.
- The agent expects gated operations to *reject* illegal moves (an out-of-graph status transition, a dependency cycle, a duplicate-name tag) rather than silently corrupt state — the database is the source of truth it relies on between sessions.
