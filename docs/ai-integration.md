# AI service integration (Prompt 14b)

FieldFlow talks to a separate AI service (`fieldflow-ai`, Node, port 4100). The service is
**suggestion-only**: it never writes business data. Every result lands in `ai_suggestions` as
`pending_review` and a person accepts or rejects it. Our own KPIs stay the numbers on screen; accepted
AI text is commentary next to them.

The contract is `fieldflow-ai/openapi.yaml` and its `HANDOFF.md`. Paths, capability ids, env var names
and the callback route are used byte for byte.

## Flow

```
 person / 19:30 scheduler                FieldFlow API                       AI service
 ────────────────────────                ─────────────                       ──────────
 POST /api/v1/ai/requests ─────────────► validate scope, AI_TARGET_REQUIRED,
                                         cost guard (1 per hour per subject+filters)
                                         INSERT ai_requests (status queued, request_id uuid)
                                         pg-boss job ai.<capability>  { aiRequestId }
                                                  │
                                         worker: read KPIs (reporting service, requester scope)
                                         build aggregate payload + label_map
                                         Zod contract check + PII guard
                                         POST {AI_SERVICE_BASE_URL}/v1/<capability> ─────────► validate, call model,
                                           Bearer AI_SERVICE_INBOUND_KEY, timeout 10 s         number + PII checks
                                         202 → ai_requests.status = sent  ◄───────────────────  202 {queued|cached}
                                                                                                │
                                         POST /api/v1/internal/ai/results  ◄───────────────────┘
                                           Bearer AI_SERVICE_OUTBOUND_KEY
                                         requestId known? capability matches?  (else 422, permanent)
                                         INSERT ai_suggestions ON CONFLICT (request_id) DO NOTHING
                                         ai_requests.status = completed, notify reviewers
 /app/ai-review ◄────────────────────── accept / reject (reviewer, note) → notify requester
 dashboards, final report, Excel ◄───── latest ACCEPTED suggestion only, marked "AI-generated, reviewed by …"
```

Retries: 202 (also `cached`) = sent; 400/401 and every other 4xx except 429 = permanent `send_failed`;
429, 5xx, network errors and timeouts throw so pg-boss retries (retryLimit 5, exponential backoff). The
`request_id` is created once with the `ai_requests` row and reused on every retry.

## What leaves the backend

Only aggregates: counts, rates and short codes. Never names, phones, emails, addresses, URLs, photos,
EXIF, GPS or user-written text. The only ids in a request are `agencyId`, `requestId` and `subject.id`
(a supervisor or campaign uuid).

| Capability | Subject | `data` |
| --- | --- | --- |
| `supervisor_daily_summary` | supervisor, one work date | `attendance {present, expected}`, `sales {units, previousUnits}`, `gifts {distributed, planned}` |
| `sales_performance` | campaign, period | `sellers [{label S1…, units, target?}]` by units, `periods [{label P1…, units}]` |
| `campaign_insights` | campaign, period | `attendance`, `sales {units, target}`, `gifts` |
| `animateur_coaching` | campaign, period | `animateurs [{label A1…, attendanceRate?, units, target?, visits}]` |

Mapping from the reporting KPIs (`packages/shared/src/kpi.js`): `present` = `attendance.verified` +
`attendance.pending`; `expected` = `attendance.expectedSlots`; `units` = `sales.units`; `previousUnits` =
`sales.units` of the **same weekday one week earlier**; `distributed` = `gifts.distributedUnits`; `planned` =
`gifts.entitledUnits`; `target` = `completion.salesTarget` (the sales_target rule, accumulated over the
elapsed days of the period); `attendanceRate` = `attendance.rate`; `visits` = `visits.count`.

A target that is unknown is **omitted**, never sent as `null`. A campaign period without any
`sales_target` rule gets no `sales_performance` or `campaign_insights`: the trigger answers 422
`AI_TARGET_REQUIRED` and the web app disables those two buttons with a tooltip.

### Label policy

- Labels are short codes: `A1` (Animateur), `S1` (seller), `P1` (period). No other label text.
- They are generated per request, ordered by units, and stored in `ai_requests.label_map`
  (`{ "A1": "<user uuid>", "P1": "2026-11-01" }`, ids and dates only).
- The same person has the same label **inside one request only**. A retry reuses the stored labels.
- Names are resolved only on our side (review page, dashboard card) through `label_map`.
- Every payload passes the Zod copy of the request schema and the PII guard
  (`packages/shared/src/aiContract.js`) before it is sent. A guard hit is a bug: the request becomes
  `send_failed`, an error is logged (paths only, never the value) and nothing is sent.

## Configuration

`apps/api/.env`:

```
AI_SERVICE_BASE_URL=http://localhost:4100   # empty = module disabled
AI_SERVICE_INBOUND_KEY=<48+ random chars>   # FieldFlow → AI service
AI_SERVICE_OUTBOUND_KEY=<48+ random chars>  # AI service → FieldFlow callback
```

Generate each key with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
The two keys are different, at least 32 characters, and must be identical in both services' `.env`. In
production the API refuses to start with a placeholder (`replace-me…`, `change-me…`). Never commit keys.

With an empty `AI_SERVICE_BASE_URL` the module is disabled: `POST /ai/requests` and the callback answer 503
`AI_DISABLED`, no job is queued and the web app hides every AI button. Everything else works as before.

## Run both services locally

1. FieldFlow API on port 4000: set the three variables above, `npm run dev`.
2. AI service (`../fieldflow-ai`): copy `.env.example` to `.env`, put the **same** two keys in
   `AI_SERVICE_INBOUND_KEY` / `AI_SERVICE_OUTBOUND_KEY`, set `FIELDFLOW_API_BASE_URL=http://localhost:4000`,
   add your own `LLM_API_KEY`, then `npm ci && npm start` (port 4100). Check `GET http://localhost:4100/health`.
3. Sign in as a supervisor, open the dashboard and press "Generate AI summary". The suggestion appears in
   `/app/ai-review` for the director within a minute; accepting it shows the card on the dashboard.

## Docker note (Prompt 16)

Run the AI service as its own container on the internal Compose network, **not published** to the host and
not behind Caddy. The API reaches it at `http://ai:4100` (`AI_SERVICE_BASE_URL`); the AI service calls the
API at `http://api:4000` (`FIELDFLOW_API_BASE_URL`, the internal URL). `GET /health` of the AI service is
public and returns `200 {"ok":true}`, so it can be the container healthcheck. Caddy must not proxy
`/api/v1/internal/*`: the callback is service-to-service only. Keys come from the deployment environment.

## Stricter than the contract

- The callback answers 422 for a `requestId` that is not in `ai_requests`, or whose capability differs.
  This stops anyone holding the outbound key from injecting suggestions we never asked for. Both are
  permanent (4xx, not 429) for the AI service.
- Our PII guard also refuses any string with 8 or more digits, because the AI service pattern misses
  grouped Algerian numbers such as `0555 12 34 56`.
