<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/memory" count="3" depth="2" digest="sha256:42356c75c312526b61229de12b83cc6c50c5c13e26e257fc61c843d6b85f38c7">

| Name | Kind | Description | Go |
|---|---|---|---|
| Memory | Independent | A durable fact, decision, convention, or gotcha an agent has learned, with provenance flags for how it was acquired. | [Memory](Memory.md) |
| Project_Memory | Associative | Junction attaching a memory to a project, recording which facts and decisions are relevant to it. | [Project_Memory](Project_Memory.md) |
| Related_Memory | Dependent | Directed edge asserting one memory supersedes, supports, or contradicts another. | [Related_Memory](Related_Memory.md) |

</ignatius-index>
