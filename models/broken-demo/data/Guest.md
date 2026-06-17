---
entity: Guest
group: core
pk:
  - user_id
columns:
  user_id:
    type: integer
    desc: "Inherited from User basetype."
  session_token:
    type: text
    desc: "Anonymous session identifier."
---

**Guest** — clean subtype of User. No findings.
