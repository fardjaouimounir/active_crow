# BACKEND INTEGRATION PROMPT — send this to the backend developer verbatim

---

## 0. Your role and objective

You own the main FieldFlow backend (an **Express/Prisma/pg-boss** API) and the
review screen will be built in the frontend. Neither changes the contract. I own
the standalone AI service at **https://github.com/Diiaaax/fieldflow-ai.git**
(already built, tested, and live-verified). Your job is to integrate it
end-to-end so we can deploy. Do **not** rewrite or re-host the AI service. Do
**not** change the database design beyond what is described here.

Product naming: the team is considering renaming **FieldFlow → ActiCrew**. Treat
that as a display/docs decision for now. **Do not rename API paths, capability
IDs, env var names or the callback route** as part of integration — those are the
contract and must stay byte-for-byte stable. We can do a coordinated display
rename afterwards.

## 1. Authoritative architecture

```
FieldFlow backend                         AI service (separate repo/service)
---------------                           ----------------------------------
1. role-scoped action/export
   triggers a pg-boss ai.* job
2. job builds an AGGREGATE payload
   (counts, codes, short labels only)
3. worker POST /v1/{capability}  ───────►  validate -> Qwen (AI Grid)
   Authorization: Bearer inbound key      -> number/PII guardrails
   body: {requestId, agencyId, ...}       -> callback POST
                                                    │
4. callback POST /api/v1/internal/ai/results ◄──────┘
   Authorization: Bearer outbound key
5. INSERT ai_suggestions row, status = pending_review
6. Human reviews in UI: accept / reject
```

Hard rules:
- The AI service **never writes business data**. It only returns a suggestion.
- Every AI result is stored as `pending_review`. A human must accept/reject.
- Only the backend writes to `ai_suggestions`. The AI service only POSTs the callback.
- The AI service is suggestion-only and de-duplicates on `requestId` **in memory, per process**
  (a restart forgets it). Your unique constraint on `request_id` is the real idempotency guard.

## 2. Files / references in the AI repo

- `openapi.yaml` — the authoritative HTTP contract.
- `fixtures/<capability>/happy.json`, `arabic.json`, `empty.json`,
  `malformed-output.json`, `provider-error.json` — exact request examples and
  edge cases for all 4 capabilities (20 fixtures).
- `README.md` — setup, env vars, smoke test.
- `.env.example` — all env vars the AI service needs.
- **Start with `docs/INTEGRATION-START-HERE.md`** (10-minute self-check, what "working" means,
  behaviours that are NOT bugs, troubleshooting).
- Current state: `npm test` = 294 passing (no network, no key needed); `npm run e2e` (real model +
  mock receiver) and `npm run contract:check` (black-box checks of the real server process) pass;
  model is `Qwen/Qwen3.8-27B` on AI Grid (`https://app.ai-grid.io/v1`); on model failure the
  service returns a normal-shaped report built from code (`confidence` 0, `output.fallback`), with
  no second model. See section 4.5 for the exact failure behaviour.
- A real example of a callback body: `docs/examples/supervisor-callback.example.json`.

## 3. What you must build in the backend

### 3.1 Database — `ai_suggestions`

```sql
-- adapt to your existing Prisma schema/migrations style
model ai_suggestions {
  id             String   @id @default(uuid())
  capability     String   -- one of the 4 IDs in section 4
  subject_type   String   -- 'supervisor' | 'campaign'
  subject_id     String
  request_id     String   @unique          -- idempotency guard
  model_version  String
  confidence     Decimal  @db.Decimal(4,3) -- 0.000 .. 1.000
  output         Json
  status         ai_suggestion_status @default(pending_review)
  reviewed_by    String?
  reviewed_at    DateTime?
  created_at     DateTime @default(now())
}

enum ai_suggestion_status {
  pending_review
  accepted
  rejected
}
```

Also add `ai_flags Json?` to `attendance_records` (or equivalent) if your Phase 4
design requires per-record AI flags. Do not store raw PII in these columns.

### 3.2 Internal callback route — `POST /api/v1/internal/ai/results`

- Must be an **internal** route (service-to-service only). Authenticate with a
  shared service key: `Authorization: Bearer <AI_SERVICE_OUTBOUND_KEY>`.
  Never a user JWT.
- Body is strict — reject unknown fields:
  ```json
  {
    "requestId": "00000000-0000-4000-8000-000000000001",
    "capability": "supervisor_daily_summary",
    "modelVersion": "Qwen/Qwen3.8-27B@prompt-v5",
    "confidence": 0.95,
    "output": { "...capability-specific report...": "..." }
  }
  ```
  `requestId` is a UUID; `capability` is one of the 4 IDs; `confidence` is a
  number in [0,1]; `output` is an object.
- Handler must be **idempotent**: `INSERT ... ON CONFLICT (request_id) DO NOTHING`
  (or check-then-insert inside a transaction). The AI service retries transient
  callback failures, so duplicates are expected.
- Return `2xx` on success. A `4xx` (other than 429) is treated as permanent and
  will not be retried; `429/5xx/network` will be retried with backoff.
  **Your extra validation is fully compatible:** returning `422` for a
  `requestId` you never sent, or a `capability` mismatch, is a permanent 4xx —
  the AI service will not retry it (there is an explicit test for this).
  Note: a permanent failure is not cached as "done", so a later `enqueue` with
  the same `requestId` will reprocess and retry the callback. That is intended.
- If `output.error` exists, still store the row as `pending_review` (so the
  failure is visible), or mark it rejected per your product decision — but never
  silently drop it.

### 3.3 pg-boss jobs

Create one queue job per capability (e.g. `ai.supervisor_daily_summary`,
`ai.sales_performance`, `ai.campaign_insights`, `ai.animateur_coaching`) with a
worker that:

1. Loads the aggregates for the subject from your DB.
2. Maps them into the exact `input.context.data` shape shown in section 4.
3. Generates a **stable UUID `requestId`** and stores it with the job (so a job
   retry reuses the same ID → AI-side dedupe + DB unique constraint both no-op).
4. POSTs to the AI service with `Authorization: Bearer <AI_SERVICE_INBOUND_KEY>`.
5. Treats HTTP `202` as success; `400/401` as permanent failures to log/alert.

### 3.4 Trigger points (Phase 1 FR-110–FR-113)

Queue AI jobs from role-scoped dashboards/actions where they add value:
- Supervisor daily report generation (`supervisor_daily_summary`)
- Sales performance view / export (`sales_performance`)
- Campaign insights view / export (`campaign_insights`)
- Animateur coaching actions (`animateur_coaching`)

KPIs already computed in the backend must remain authoritative. The AI service
recomputes its own KPIs from the payload and uses them for number-fidelity
checking; your UI should display your own backend KPIs as the source of truth.

### 3.5 Review workflow

- A screen lists `pending_review` suggestions, filterable by capability,
  subject, agency and date (reuse the unified filters from FR-111).
- Each row shows `output` in a readable form plus `modelVersion` and `confidence`.
- `Accept` → status `accepted`, set `reviewed_by` + `reviewed_at`.
- `Reject` → status `rejected`, set `reviewed_by` + `reviewed_at`.
- Only accepted suggestions may influence dashboard text/exports. Never write
  AI output directly into business tables.

## 4. Exact HTTP contract

### 4.1 Call the AI service

```
POST {AI_SERVICE_BASE_URL}/v1/{capability}
Authorization: Bearer <AI_SERVICE_INBOUND_KEY>
Content-Type: application/json
```

`{capability}` is one of:
`supervisor_daily_summary`, `sales_performance`, `campaign_insights`, `animateur_coaching`.

Request body (strict — no extra fields, `locale` is `en` or `ar`):

```json
{
  "requestId": "<uuid>",
  "agencyId": "<uuid>",
  "subject": { "type": "supervisor", "id": "sup-001" },
  "input": {
    "text": null,
    "fileUrl": null,
    "context": {
      "workDate": "2026-11-20",
      "from": "2026-11-01",
      "to": "2026-11-20",
      "locale": "en",
      "data": { "...see per-capability shapes below..." }
    }
  }
}
```

`subject.type` must be:
- `supervisor_daily_summary` → `supervisor`
- the other three → `campaign`

Responses:
- `202` → `{ "data": { "requestId": "<uuid>", "status": "queued" | "cached" } }`
  (`cached` means duplicate `requestId` — no work was done).
- `400` → validation error, invalid subject, or PII firewall rejection.
- `401` → missing/invalid inbound key.

### 4.2 Per-capability `input.context.data` shapes (copy exactly)

`supervisor_daily_summary`:
```json
{
  "attendance": { "present": 42, "expected": 50 },
  "sales": { "units": 120, "previousUnits": 100 },
  "gifts": { "distributed": 80, "planned": 100 }
}
```

`sales_performance`:
```json
{
  "sellers": [
    { "label": "S1", "units": 120, "target": 100 },
    { "label": "S2", "units": 80, "target": 100 }
  ],
  "periods": [
    { "label": "P1", "units": 90 },
    { "label": "P2", "units": 110 }
  ]
}
```

`campaign_insights`:
```json
{
  "attendance": { "present": 42, "expected": 50 },
  "sales": { "units": 120, "target": 150 },
  "gifts": { "distributed": 80, "planned": 100 }
}
```

`animateur_coaching`:
```json
{
  "animateurs": [
    { "label": "A1", "attendanceRate": 0.9, "units": 120, "target": 100, "visits": 4 },
    { "label": "A2", "attendanceRate": 0.7, "units": 80, "target": 100, "visits": 2 }
  ]
}
```

#### Missing, zero or inconsistent values (changed in prompt-v3)
The `data` object is `z.record(z.unknown())`, so `"target": null` and omitting
the field are accepted and treated identically: the value is **missing**. Prefer
omitting it. Nothing is rejected; the service reports what it could not compute.

- **Undefined is not 0.** A metric whose input is missing, or whose denominator is
  0, is **omitted from `output.kpis`** (previously it was reported as `0`, so a
  missing target read as "0% attainment" and `targetGap` as `-120`). Your UI must
  treat an absent KPI key as "not available". An aggregate over several sellers or
  animateurs is omitted when any one of them lacks the field.
- **`output.dataQuality`** (new, additive, optional): present only when the service
  found a problem, as `[{ "code": "TARGET_MISSING", "severity": "missing" }]`. It
  is computed by code, never by the model. Severities: `conflict` (impossible or
  contradictory data), `missing` (an input is absent, so metrics are unavailable),
  `info`. Codes: `PRESENT_GT_EXPECTED`, `NEGATIVE_VALUE`, `DISTRIBUTED_GT_PLANNED`,
  `DUPLICATE_LABEL`, `RATE_OUT_OF_RANGE`, `TARGET_ZERO`, `NONNUMERIC`,
  `FIELD_MISSING`, `TARGET_MISSING`, `DENOMINATOR_ZERO`, `PREVIOUS_ZERO`,
  `PERIODS_SELLERS_MISMATCH`. Show it in the review screen next to the report.
  The report text itself is also told to state each problem and to recommend
  verifying the data.
- **`confidence`** now also falls when per-seller / per-animateur fields are
  missing (a missing seller `target` lowers it); before, only absent top-level
  blocks did. It measures data completeness x generation path, not accuracy.
- Send animateur `attendanceRate` as a ratio from 0 to 1 (`0.9`, not `90`);
  a value outside that range is flagged `RATE_OUT_OF_RANGE`.
- Please confirm your review screen and storage accept the new optional
  `output.dataQuality` key and a `kpis` object with fewer keys than before.

### 4.3 Callback the AI service sends you

```
POST {FIELDFLOW_API_BASE_URL}/api/v1/internal/ai/results
Authorization: Bearer <AI_SERVICE_OUTBOUND_KEY>
Content-Type: application/json
```
Body:
```json
{
  "requestId": "<same uuid you sent>",
  "capability": "supervisor_daily_summary",
  "modelVersion": "Qwen/Qwen3.8-27B@prompt-v5",
  "confidence": 0.95,
  "output": { "locale": "en", "headline": "...", "summary": ["..."], "attention": [], "recommendedActions": [], "kpis": {} }
}
```
`modelVersion` variants you must accept as opaque strings:
- `Qwen/Qwen3.8-27B@prompt-v5` — normal generated output
- `Qwen/Qwen3.8-27B@deterministic-fallback@prompt-v5` — guardrail fallback
- `none@no-data` / `none@pii-firewall` — error output

The `@prompt-vN` suffix identifies the prompt and validation rules that produced
the result. Treat it as part of the opaque string; it changes when those rules do.

### 4.4 Output shapes (all include `locale` and code-computed `kpis`)

- `supervisor_daily_summary`: `headline`, `summary[3..5]`, `attention[{type,text,refs[]}]`, `recommendedActions[]`, `kpis`
- `sales_performance`: `ranking[]`, `trends[]`, `anomalies[]`, `recommendedActions[]`, `kpis`
- `campaign_insights`: `narrative`, `risks[{severity:low|medium|high,text,evidence[]}]`, `opportunities[]`, `decisions[]`, `kpis`
- `animateur_coaching`: `coaching[{label,strengths[],gaps[],actions[],evidenceRefs[]}]`, `campaignActions[]`, `kpis`

**Introduced in prompt-v4 (current prompt: v5): `output.insights` (additive, optional).** The service now detects
findings in code (value vs target, vs previous period, vs plan, highest / lowest of a group,
data problems), ranks them, and asks the model for typed claims about them. The report
fields above are rendered from those claims, so their shape is unchanged. `insights` shows
the provenance:

```json
"insights": {
  "findings": [{ "id": "F1", "type": "TARGET_BELOW", "scope": "entity", "entity": "S2",
                 "polarity": "adverse", "rank": 1, "values": { "units": 45, "target": 100 } }],
  "claims":   [{ "kind": "observation|interpretation|hypothesis|recommendation",
                 "findingIds": ["F1"], "text": "...", "source": "model|code" }]
}
```

- `kind: "hypothesis"` is a possible explanation to investigate, never a confirmed fact:
  show it as such. `source: "code"` is a statement the service wrote itself because the
  model skipped a top finding (or because the model failed: the fallback is now built from
  the findings, so it carries the same information).
- `rank` is priority: data conflicts, then adverse findings by relative size of the gap
  (shortfall as a fraction of its own target / plan / expected / previous), then positives.
  It is a proposal, not an absolute severity. Risk `severity` in `campaign_insights` is
  relative to the report (first adverse finding high, next two medium, others low; data
  issues medium).
- `OUTPUT_MODE=legacy` switches back to the previous behaviour (the model writes the fields
  directly, no `insights`). Default is `claims`.
- Please confirm your review screen and storage accept the optional `output.insights` key.

**New in prompt-v5 (additive): claim validation.** The service now enforces, in code, that a report
never states a cause as fact, invents a metric or a role for attendees, names a label or a figure the
claim's findings do not support, contradicts a finding, or narrates conflicting data as normal. See
`docs/claim-validation.md`. What you will see:

- `output.insights.rejected`: `[{ "reason": "CAUSAL_NOT_HYPOTHESIS", "kind": "interpretation" }]`, present only
  when a claim was removed (or the headline was replaced: `reason: "HEADLINE_ORDER", kind: "headline"`, when the model's headline
  did not lead with the code's top-priority topic). When a removed recommendation leaves a report without any, a neutral
  "review" recommendation written by the code appears with `source: "code"`. The removed text is never exposed. A report with rejections is still a
  normal AI report (confidence factor 0.85, as for any repaired report).
- `output.insights.claims[].downgradedFrom`: a hedged cause that was reclassified as `hypothesis`.
- `output.insights.findings[].polarity` may now be `"cause"` (a `KNOWN_CAUSE` finding).
- **Optional input `data.causes`**: `[{ "label": "S2", "code": "STK-01" }]`. It is the only way a report can state a
  cause as a fact. The code is opaque (the service does not interpret it); map it to a meaning in your UI.
  Free text is not accepted (PII firewall). Do not send it unless you have an explicit, reliable cause.
- Attendance counts are described as "present" / "expected" only; the service no longer names who the
  attendees are, because the contract does not define them. Tell us the definition if you want it used.
- `insights.findings[].values` of an attendance finding now include `missingPct` (share of the expected attendance that is
  missing, e.g. 20 for 40 of 50): plain arithmetic on the two supplied fields.
- **`data.causes` codes must look like the other labels** (letters up to 6, optional separator, digits, e.g. `STK-01`, `STK_1`).
  Anything else (`STOCKOUT`, free text) makes the PII firewall reject the **whole request** with 400. A report states a
  cause as fact only in a sentence that names that code; otherwise the cause is only a hypothesis.
- `attention[].type` is now derived from the finding type (`attendance_gap`, `gifts_undistributed`, `data_issue`,
  `hypothesis`...), no longer free text. `refs` / `evidence` may hold metric or field names and finding codes, not only labels.
- Please confirm your review screen tolerates the new optional keys above.

**Two kinds of non-happy output (verified; this is exactly what the service does):**

1. `output` is an **error object**, only for these two cases:
   ```json
   { "error": { "code": "NEEDS_DATA", "message": "..." } }
   ```
   `NEEDS_DATA` (`modelVersion: "none@no-data"`) and `PII_FIREWALL` (`modelVersion: "none@pii-firewall"`).
   Both have `confidence: 0`.
2. The model failed (provider unavailable, timeout, rate limit, or an unusable reply after one repair).
   The callback is **still a normal report with the same fields** (`headline`, `summary`, `kpis`...),
   built from code, with `confidence: 0`, `modelVersion` = `Qwen/Qwen3.8-27B@deterministic-fallback@prompt-vN`
   and an extra key:
   ```json
   "fallback": { "used": true, "reasonCode": "AI_UNAVAILABLE", "attempts": 1 }
   ```
   `reasonCode` is one of `AI_UNAVAILABLE`, `AI_MODEL_TIMEOUT`, `AI_RATE_LIMITED`, `AI_AUTH_FAILED`, `AI_BAD_REQUEST`,
   `AI_MODEL_NOT_FOUND`, `AI_PROVIDER_ERROR`, or a validation reason (`MODEL_JSON_PARSE_FAILED`,
   `INVENTED_NUMERALS`, `UNKNOWN_LABEL`, `SCHEMA_INVALID`...). Do not wait for `output.error.code = "AI_*"`: it is never sent.
   Store it and show it like any report, marked as a fallback (the UI can use `output.fallback.used` or `confidence === 0`).

### 4.5 Operational behaviour your backend must plan for

- **Asynchronous.** `POST` returns `202` immediately; the result arrives later by callback. Measured: a report
  takes about 3 to 30 seconds (average about 7 s), about 1 s when the provider returns a cached answer, and up to
  ~60 s plus one repair retry in the worst case. Show a "generating" state; do not block the HTTP request.
- **No callback is guaranteed to arrive.** The AI service keeps its queue and its duplicate memory **in memory**.
  If it restarts while a job is running, that job's callback never comes. Treat "no callback after a few minutes"
  as failed and re-POST **the same `requestId`**: your unique constraint on `request_id` keeps one row, and the AI
  side re-processes it (a restarted service has forgotten it; a running service answers `cached` both for a
  request it is still processing and for one it already delivered, and does nothing).
- **Callback delivery.** Up to 4 attempts with 250 / 500 / 1000 ms backoff on network errors, `429` and `5xx`; a
  `4xx` other than `429` is final and never retried. Each attempt times out after 10 s (`CALLBACK_TIMEOUT_MS`).
  Answer `2xx` fast and do the heavy work after replying.
- **Throttle.** The service does not limit concurrency. The provider rate-limits: bursts produce fallback reports
  (`reasonCode: AI_RATE_LIMITED`). About 3 concurrent jobs is what was tested.
- **Body size.** A report is about 5 KB (`insights` included). Express's default JSON limit (100 KB) is enough.
- **Nothing in the request tells the callback who asked.** `agencyId` is validated but not echoed; map the callback
  to your job by `requestId`.
- **Language.** `locale` (`en` or `ar`) controls the language of the text; numbers are written with digits 0-9.

## 5. PII firewall (non-negotiable)

The AI service rejects any payload containing:
- forbidden keys: name/firstname/lastname/fullname/phone/mobile/email/address/
  ssn/nationalid/exif/gps/photo/image/base64/payload, etc.
- phone-shaped, email-shaped, URL, or base64-shaped values
- strings longer than 200 chars

Use **counts, codes and short labels only** — e.g. `A1`, `PDV-031`, `S1`, never
employee/customer names, phone numbers, raw photos or EXIF. Your approach of
generating labels per request and keeping the label↔entity mapping in your own
DB is exactly right — no name ever leaves the backend. If the backend sends
PII, the request is rejected (400) or the callback contains `PII_FIREWALL`.
Fix the aggregation, not the AI service.

## 6. Env vars / deployment

AI service (set in its host, never committed; `.env` is gitignored):
```
AI_SERVICE_INBOUND_KEY=<strong random>
AI_SERVICE_OUTBOUND_KEY=<strong random>
FIELDFLOW_API_BASE_URL=https://<backend-host>
LLM_BASE_URL=https://app.ai-grid.io/v1
LLM_API_KEY=<fresh rotated AI Grid key>
LLM_MODEL=Qwen/Qwen3.8-27B
LLM_JSON_MODE=false
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=16000
LLM_TIMEOUT_MS=60000
CALLBACK_TIMEOUT_MS=10000
PORT=4100
LOG_LEVEL=info
OUTPUT_MODE=claims   # optional; "legacy" = previous behaviour, no output.insights
```
Backend must have the **matching** `AI_SERVICE_INBOUND_KEY` and
`AI_SERVICE_OUTBOUND_KEY`, and expose `/api/v1/internal/ai/results` at the
`FIELDFLOW_API_BASE_URL` above.

**Container files are included in the AI repo:** `Dockerfile`, `.dockerignore`
and `compose.yaml`. The image runs as an unprivileged user on Node 22; secrets
are injected from the gitignored `.env` at runtime (never baked into the image).
The Docker healthcheck uses Node's built-in `fetch` on the public `GET /health`
route — no curl needed. The compose file joins an external network named
`fieldflow_internal` (create it once with `docker network create fieldflow_internal`,
or rename it in `compose.yaml` to match your existing internal network). The
backend must be attached to that same network; `FIELDFLOW_API_BASE_URL` should
use the API's internal hostname (e.g. `http://api:3000`).

AI service deploy: Node >= 22, `npm ci`, `npm start`. Confirmed working for the
internal-container setup: `GET /health` is a public, unauthenticated route
registered on the Express app (no service key needed) and returns
`200 {"ok":true}` — safe for Docker healthcheck / VPS orchestrator probes.
`FIELDFLOW_API_BASE_URL` should be the **internal** API URL on the VPS network.
The service fails fast at startup if any secret is a placeholder.

The AI Grid key previously pasted in chat is compromised — use a fresh rotated
key only. Never paste keys into chat, code, tests, logs or commits. Exchange
shared service keys with me privately. The `AI_SERVICE_INBOUND_KEY` and
`AI_SERVICE_OUTBOUND_KEY` must match exactly on both sides.

**Status:** I have not independently verified that the AI Grid key was rotated
at the provider. Before deploying, rotate it and confirm the new key is the one
placed in the AI service's `.env`. Only fresh keys may be used.

## 7. Acceptance criteria (definition of done)

1. `ai_suggestions` table + `ai_suggestion_status` enum exist.
2. `POST /api/v1/internal/ai/results` exists, service-key authenticated, strict
   body validation, idempotent on `request_id`.
3. All 4 pg-boss jobs queue and call the correct route with correct
   `subject.type`.
4. End-to-end test: trigger a job → `202` → callback → `ai_suggestions` row with
   `status = pending_review`, correct `request_id`, `capability`, `model_version`,
   `confidence`, `output`.
5. Review UI: accept and reject both work and set `reviewed_by`/`reviewed_at`.
6. Duplicate `requestId` produces exactly one row and one suggestion (no double
   callback / no duplicate spend).
7. `NEEDS_DATA`, `PII_FIREWALL` and model-failure outputs are stored and visible
   rather than crashing the worker.
8. Bilingual `en`/`ar` payloads produce readable Arabic/English output.
9. No PII crosses into the AI service; no secrets in code or commits.
10. Both services deploy with health checks and matching shared keys.

## 8. What NOT to do

- Do not create a second backend or reimplement the AI service.
- Do not let AI output write business data directly.
- Do not skip the `pending_review` step.
- Do not rename API paths, capability IDs, env var names or the callback route
  as part of the ActiCrew display rename.
- Do not send names, phones, emails, URLs, base64, EXIF or raw photos.
- Do not reuse the compromised AI Grid key.

## 9. Questions / blockers

If any field above conflicts with the existing Phase 3/Phase 4 architecture
docs, message me before changing the contract — the AI service side is already
deployed and verified, so contract changes require coordination on both sides.
