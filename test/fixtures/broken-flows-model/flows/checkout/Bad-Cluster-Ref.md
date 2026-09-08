---
process: Bad Cluster Ref
number: 2
inputs:
  - from: ext:Buyer
    data: order details
outputs:
  - to: cluster:no-such-cluster
    data:
      SomeEntity: [id]
  - to: cluster:role-grants
    data:
      NotAMember: [id]
  - to: cluster:role-grants
    data: {}
---

Fires flow.unknown_cluster (no-such-cluster has no clusters/ file), flow.cluster_member_unknown
(NotAMember is not in role-grants' entities:), and flow.cluster_no_members (the third entry maps
no members).
