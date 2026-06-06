---
external: Customer
---

The buyer who places orders and settles invoices. Modelled as an external
entity (the actor who *initiates* requests), distinct from the `Party`
data store that *records* who they are. The same real-world person appears
on the diagram twice: as `Customer` (the source/sink of requests) and,
once their details are persisted, as rows in `db:Party`.
