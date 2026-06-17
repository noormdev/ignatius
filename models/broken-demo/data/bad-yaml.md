---
entity: Shipment
pk:
  - shipment_id
columns:
  shipment_id: { type: integer
  carrier:
    type: text
---

**Shipment** — triggers `parse.invalid_yaml` (Class B).

The frontmatter YAML has an unclosed brace on the `shipment_id` line. The parser catches the syntax error inside the scan loop, records a `GlobalError` with `ruleId: 'parse.invalid_yaml'`, and skips this file. The entity does NOT appear in `model.nodes`. The global banner names the file.
