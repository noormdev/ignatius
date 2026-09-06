<ignatius-breadcrumb>

↑ [Flows](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/memory-lifecycle" count="6" depth="2" digest="sha256:422c062f0be00d1195456be2d2d5174c7b116fb8a9c9371463ccce4555402f1b">

| Name | Kind | Description | Go |
|---|---|---|---|
| Attach-Memory-to-Project | process | Idempotently scopes a memory to a project context | [Attach-Memory-to-Project](Attach-Memory-to-Project.md) |
| Consolidate-Memory | process | Folds a duplicate memory into a canonical one and marks it superseded | [Consolidate-Memory](Consolidate-Memory.md) |
| Create-Memory | process | Persists a new long-term memory fact after validating domain and category | [Create-Memory](Create-Memory.md) |
| Filter-Memories-by-Tags | process | Returns active memories carrying every requested tag, newest-recalled first | [Filter-Memories-by-Tags](Filter-Memories-by-Tags.md) |
| Relate-Memories | process | Creates a directed semantic edge between two memories using a controlled verb | [Relate-Memories](Relate-Memories.md) |
| Set-Memory-Relevance | process | Advances a memory's relevance status through a gated, journaled transition | [Set-Memory-Relevance](Set-Memory-Relevance.md) |

</ignatius-index>
