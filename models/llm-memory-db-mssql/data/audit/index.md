<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/audit" count="6" depth="2" digest="sha256:68d2456a4e0e0cda93bb7eb72b152dfec08d52de32af749928d03672601e65f5">

| Name | Kind | Description | Go |
|---|---|---|---|
| Artifact_StateTransition | Subtype | Subtype pinning a StateTransition journal row to the artifact whose relevance status changed. | [Artifact_StateTransition](Artifact_StateTransition.md) |
| Memory_StateTransition | Subtype | Subtype pinning a StateTransition journal row to the memory whose relevance status changed. | [Memory_StateTransition](Memory_StateTransition.md) |
| Milestone_StateTransition | Subtype | Subtype pinning a StateTransition journal row to a milestone's tracking or relevance status change. | [Milestone_StateTransition](Milestone_StateTransition.md) |
| Note_StateTransition | Subtype | Subtype pinning a StateTransition journal row to the note whose relevance status changed. | [Note_StateTransition](Note_StateTransition.md) |
| StateTransition | Independent | The immutable, write-once audit journal of every relevance and tracking status change in the system. | [StateTransition](StateTransition.md) |
| Task_StateTransition | Subtype | Subtype pinning a StateTransition journal row to the composite-keyed task whose tracking status changed. | [Task_StateTransition](Task_StateTransition.md) |

</ignatius-index>
