---
entity: Discount
group: marketing
pk:
  - discount_id
columns:
  discount_id:
    type: integer
    desc: "Discount surrogate key."
  code:
    type: text
    desc: "Promo code."
  percent:
    type: integer
    desc: "Percent off."
---

**Discount** — triggers `entity.unknown_group` (Class A).

The frontmatter declares `group: marketing` but there is no `_groups/marketing.md` file. The entity renders without a group color band and carries a ⚠ triangle. The fix is either creating the group file or correcting the name.
