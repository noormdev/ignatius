---
entity: Admin
group: core
pk:
  - user_id
columns:
  user_id:
    type: integer
    desc: "Inherited from User basetype."
  permissions:
    type: text
    desc: "JSON-encoded permission set."
---

**Admin** — clean subtype of User. No findings.
