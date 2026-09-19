---
description: Minting tags, attaching them to memories one at a time or in bulk, and merging duplicates.
---

<ignatius-breadcrumb>

↑ [Flows](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/tag-administration" count="4" depth="2" digest="sha256:42bcdcb6224a88d795c2e4f19d4fdbb7bee4795ce4cb3485e37db51981b5b95e">

| Name | Kind | Description | Go |
|---|---|---|---|
| Attach-Tag-to-Memory | process | Idempotently links one tag to one memory | [Attach-Tag-to-Memory](Attach-Tag-to-Memory.md) |
| Bulk-Attach-Tag-to-Memories | process | Attaches one tag to a batch of memories in a single round trip | [Bulk-Attach-Tag-to-Memories](Bulk-Attach-Tag-to-Memories.md) |
| Create-Tag | process | Mints a new uniquely-named tag and returns its tag_id | [Create-Tag](Create-Tag.md) |
| Merge-Tag | process | Folds a duplicate tag into a canonical one across all junction tables | [Merge-Tag](Merge-Tag.md) |

</ignatius-index>
