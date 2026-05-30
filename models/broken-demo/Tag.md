---
entity: Tag
group: core
pk: "tag_id"
columns:
  tag_id:
    type: integer
    desc: "Tag surrogate key."
  label:
    type: text
    desc: "Display label."
---

**Tag** — triggers `entity.invalid_field_type` (Class A).

`pk` is declared as a string `"tag_id"` rather than an array `[tag_id]`. The validator detects the wrong runtime shape and decorates the entity with a ⚠ triangle. Downstream renderers receive a defaulted-empty `pk` array so the dict and graph still produce output instead of crashing.
