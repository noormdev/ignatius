---
entity: Subscription
group: catalog
pk:
  - subscription_id
columns:
  subscription_id:
    type: integer
    desc: "Unique identifier for the subscription."
  sku:
    type: text
    desc: "Stock-keeping unit; unique subscription code."
  name:
    type: text
    desc: "Display name of the subscription plan."
  period_unit:
    type: text
    desc: "Billing period unit (e.g. month, year)."
  list_price:
    type: decimal
    desc: "Catalog price per billing period."
ak:
  - rule: unique subscription code
    columns:
      - sku
examples:
  - subscription_id: 5
    sku: SVC-ANALYTICS-PRO-MO
    name: Meridian Analytics Pro (Monthly)
    period_unit: month
    list_price: 89.00
  - subscription_id: 6
    sku: SVC-ANALYTICS-PRO-YR
    name: Meridian Analytics Pro (Annual)
    period_unit: year
    list_price: 899.00
  - subscription_id: 7
    sku: SVC-ANALYTICS-ENTERPRISE-YR
    name: Meridian Analytics Enterprise (Annual)
    period_unit: year
    list_price: 4999.00
---

# Subscription

A **Subscription** is a sellable recurring service billed on a repeating period — monthly, yearly, and so on. It is the catalog counterpart to a Product for anything sold as an ongoing plan rather than a one-time purchase.

It is modeled apart from Product because recurrence is a first-class property: it carries a billing `period_unit` and a price *per period*, which a one-time product does not have.

## Business rules

- **SKU is unique** — every subscription has exactly one stock-keeping code.
