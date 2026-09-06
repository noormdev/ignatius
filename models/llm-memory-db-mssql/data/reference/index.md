<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/reference" count="10" depth="2" digest="sha256:03ea72a18bfdd8e1326aa2ec5430df517cd327660a6ff3548861da69b9bd8b22">

| Name | Kind | Description | Go |
|---|---|---|---|
| DependencyVerb | Classifier | Controlled vocabulary of edge labels (blocks, requires, follows) for the task dependency graph. | [DependencyVerb](DependencyVerb.md) |
| MemoryCategory | Classifier | Controlled vocabulary for the epistemic kind of a memory entry (fact, decision, convention). | [MemoryCategory](MemoryCategory.md) |
| MemoryDomain | Classifier | Controlled vocabulary of broad subject areas (coding, architecture, preferences) classifying memories. | [MemoryDomain](MemoryDomain.md) |
| MemoryRelationVerb | Classifier | Controlled vocabulary of directed edge labels for the memory relation graph, storing both verb directions per row. | [MemoryRelationVerb](MemoryRelationVerb.md) |
| NoteType | Classifier | Controlled vocabulary classifying a note's structural role — project, milestone, or task. | [NoteType](NoteType.md) |
| RelevanceStatus | Classifier | Controlled vocabulary for lifecycle relevance states (active, archived, deleted) of memories, artifacts, and notes. | [RelevanceStatus](RelevanceStatus.md) |
| RelevanceStatus_Allowed | Dependent | Legal from/to edges of the RelevanceStatus transition graph, checked before journaling a relevance change. | [RelevanceStatus_Allowed](RelevanceStatus_Allowed.md) |
| StateTransitionType | Classifier | Controlled vocabulary classifying which entity and state dimension a journal entry belongs to. | [StateTransitionType](StateTransitionType.md) |
| TrackingStatus | Classifier | Controlled vocabulary for progress states (pending, in_progress, done) applied to tasks and milestones. | [TrackingStatus](TrackingStatus.md) |
| TrackingStatus_Allowed | Dependent | Legal from/to edges of the TrackingStatus transition graph, checked before journaling a tracking change. | [TrackingStatus_Allowed](TrackingStatus_Allowed.md) |

</ignatius-index>
