---
kind: file
title: Payment Gateway Log
---

Append-only log of raw payment-gateway responses written by the Collect Payment
process. Each entry records the gateway transaction reference, HTTP status, and
the raw response payload. Used for reconciliation and dispute resolution; never
read back during normal processing.

Retained for 7 years per PCI-DSS Requirement 10.3. Not an entity — the log is
opaque binary/JSON blobs, not structured relational data.
