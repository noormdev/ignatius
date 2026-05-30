---
entity: Product
group: core
pk:
  - product_id
---

**Product** — triggers `entity.missing_columns` (Class A).

The frontmatter declares an `entity` and a `pk` but no `columns` field at all. The validator defaults `columns` to `{}` so downstream renderers do not crash, but the missing field is flagged. The entity renders with a ⚠ triangle and an empty attribute table.
