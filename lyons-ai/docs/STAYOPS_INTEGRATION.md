# StayOps Integration (Proposed Contract)

**Status: NOT CONNECTED.** No StayOps source code or API was available in the environment, so no StayOps code was read or modified. The adapter in `src/integrations/stayops/stayops.ts` codes against the contract **proposed** below. It is disabled until `STAYOPS_API_BASE_URL` and `STAYOPS_API_TOKEN` are set. It is also **read-only** and **business-scope only**.

## What LYONS AI needs (read-only)

```
GET {STAYOPS_API_BASE_URL}/api/agent/v1/turnovers?from=<ISO>&to=<ISO>
GET {STAYOPS_API_BASE_URL}/api/agent/v1/jobs?from=<ISO>&to=<ISO>
GET {STAYOPS_API_BASE_URL}/api/agent/v1/inspections?from=<ISO>&to=<ISO>
Authorization: Bearer <agent token>
Accept: application/json

200 OK
{ "items": [ ... ] }
```

Suggested item fields:
- **turnovers:** `id, property_name, checkout_at, checkin_at, assigned_cleaner|null, status, notes`
- **jobs:** `id, property_name, type, scheduled_start, scheduled_end, cleaner|null, status`
- **inspections:** `id, property_name, due_at, status (passed|failed|pending|overdue), inspector, issues[]`

## Security requirements for the StayOps side
1. A **dedicated agent token**, separate from user sessions. Scope it to these read endpoints only, make it revocable, and rotate it every 90 days.
2. Rate-limit the endpoints, and log access under a distinct "LYONS AI" actor.
3. Return no guest PII beyond what operations need (no payment data, no guest phone numbers unless required).
4. Test on **staging** first. Then authorise production access explicitly.

## Adapter behaviour
- Errors, non-200 responses, and contract mismatches fail loudly. The agent is instructed to say "StayOps unavailable" and never invent jobs.
- Item text (notes, issues) is wrapped as untrusted content, because it can contain guest- or cleaner-written text.
- Redirects are refused. Each response is capped at 200 items.

## Later: write actions (M3+, requires your authorisation)
Assigning cleaners or rescheduling would be new tools classed `external_communication` (they notify cleaners). They would require approval and idempotency keys (`Idempotency-Key` header on the StayOps side).
