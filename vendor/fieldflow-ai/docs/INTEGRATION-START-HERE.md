# Integrating the FieldFlow AI service: start here

**Goal of this milestone (one report, end to end):** the FieldFlow backend requests one
`supervisor_daily_summary` -> the AI service generates it with Qwen -> the callback reaches the Express backend ->
the backend saves it as `pending_review` -> the frontend shows it. Nothing else is needed to call it integrated.

**Status: integration-ready, not production-ready.** What is verified, and what is not, is listed at the end.
Contract details: `HANDOFF.md` (what the backend must build) and `openapi.yaml`. This page is the fast path.

## 1. Prove the AI side works on your machine (10 minutes, before touching the backend)

```bash
git clone https://github.com/Diiaaax/fieldflow-ai.git && cd fieldflow-ai
git checkout feat/claims-validation        # the branch this guide and HANDOFF.md describe
npm ci
npm test                                   # expect: 294 passed. No network and no key needed.
cp .env.example .env                       # then set: AI_SERVICE_INBOUND_KEY, AI_SERVICE_OUTBOUND_KEY (any strong random)
                                           # and LLM_API_KEY (ask the owner; never commit it)
npm run e2e                                # real Qwen call + a mock receiver. expect: E2E PASS
npm run contract:check                     # black-box check of the real server process. expect: RESULT: 18 passed, 0 failed
```

`npm test` proves the logic. `npm run e2e` proves Qwen answers and the callback is delivered. `npm run contract:check`
proves the HTTP contract (auth, validation, retries, duplicates) the way your backend will see it. **If all three pass,
the AI service is working; a failure after that is in the wiring, not in the AI.** Do not edit the AI service to make
your side pass: the contract is fixed (HANDOFF.md section 8).

## 2. Wire your backend

1. **Call:** `POST {AI_SERVICE_BASE_URL}/v1/supervisor_daily_summary`, header `Authorization: Bearer <AI_SERVICE_INBOUND_KEY>`,
   body as in `fixtures/supervisor_daily_summary/happy.json` (new `requestId` UUID per job; keep it stable across retries).
   Expect `202 {"data":{"requestId":"...","status":"queued"}}`.
2. **Receive:** implement `POST /api/v1/internal/ai/results`, `Authorization: Bearer <AI_SERVICE_OUTBOUND_KEY>`, strict body
   `{requestId, capability, modelVersion, confidence, output}`. Save one row per `requestId` (unique constraint),
   `status = pending_review`. Reply `2xx` quickly. A `4xx` (not 429) is final and never retried; `429/5xx` is retried.
3. **Set `FIELDFLOW_API_BASE_URL`** on the AI service to your backend's URL as seen from the AI service (the callback goes
   to `{FIELDFLOW_API_BASE_URL}/api/v1/internal/ai/results`).
4. **See callbacks before your route exists:** `npm run mock:callback` listens on port 3000 and prints every callback.
   Point `FIELDFLOW_API_BASE_URL=http://127.0.0.1:3000` at it.

Real example bodies: `docs/examples/` (normal report, fallback report, `NEEDS_DATA`).

## 3. What "working" means (acceptance for this milestone)

1. `POST` returns `202`.
2. The callback arrives at your route with the right key, usually within about 3 to 30 seconds.
3. One row is saved with the right `request_id`, `capability`, `model_version`, `confidence`, `output`.
4. The frontend shows it: headline, summary, attention items, recommended actions.
5. Sending the same `requestId` again creates no second row.
6. Also test once: wrong key (`401`), your backend down (callback retried), and the two non-happy outputs below.

## 4. Behaviours that are NOT bugs

| You see | Meaning | What to do |
|---|---|---|
| `confidence: 0`, `modelVersion` ends in `@deterministic-fallback@prompt-v5`, `output.fallback.reasonCode` | The model was unavailable, timed out, was rate-limited or gave an unusable reply. The service sent a **normal-shaped report built from code**. | Store and show it, marked as a fallback. |
| `output.error.code` = `NEEDS_DATA` or `PII_FIREWALL` | The only two real error outputs (`confidence: 0`, `modelVersion` `none@...`). **`AI_*` codes are never sent as `output.error`.** | Store and show it. |
| A KPI key is missing from `output.kpis` | The value cannot be computed from the data (missing input, zero denominator). It is never reported as 0. | Treat an absent key as "not available". |
| Extra keys: `output.insights`, `output.dataQuality`, `insights.rejected` | Additive and optional (provenance, data problems). | Ignore or display; do not reject unknown keys inside `output`. |
| `insights.claims[].kind = "hypothesis"` | A possible explanation, never a confirmed cause. | Show it as a hypothesis. |
| `202` arrives instantly, the result much later | Asynchronous by design. | Show "generating". |
| `status: "cached"` on a repeated `requestId` | Duplicate. No work is done. | Normal. The service remembers duplicates only in memory (a restart forgets them), so keep your unique constraint. |
| The text is in Arabic when `locale: "ar"` | Correct. Numbers use digits 0-9. | None. |
| `modelVersion` changes (`@prompt-v5`...) | Identifies the prompt and validation rules. | Treat as an opaque string. |

## 5. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401` from the AI service | `AI_SERVICE_INBOUND_KEY` differs between the two sides. |
| `400 VALIDATION_ERROR` | Body has an unknown field or a wrong type. The `details` field says which. The request is strict. |
| `400 PII_FIREWALL` | A value looks like a name, phone, email, URL or free text. Send counts, codes and short labels such as `S1`, `A2`, `PDV-031` only. |
| `400 INVALID_SUBJECT` | `subject.type` must be `supervisor` for this capability and `campaign` for the other three. |
| `202` but no callback | `FIELDFLOW_API_BASE_URL` unreachable from the AI service, wrong route, or your route returned a non-2xx. Check the AI service log for `Callback HTTP ...`. Use `npm run mock:callback` to isolate. |
| Callback arrives several times | Your route returned `5xx`/`429` or timed out (10 s) at least once. Be idempotent on `requestId`. |
| Callback stops after one try | Your route returned a `4xx` (not 429): treated as final by design. |
| Many `fallback` reports | Provider outage or rate limit (`reasonCode`). Reduce concurrency (about 3 was tested) and check the AI Grid key and quota. |

## 6. What is verified and what is not

**Verified (by running it):** 294 automated tests; `npm run e2e` against the real model; 18 black-box contract checks
of the real server process (auth, validation, PII, empty data, retry after a backend `503`, no retry after `422`,
duplicates, exact callback shape); an offline benchmark of 45 scenarios (plus 10 held-out) in English and Arabic.

**Not verified, so do not assume:**
- It has never talked to the real FieldFlow backend or frontend. That is this milestone.
- Accuracy on real data. The benchmark is synthetic and its judge is lexical (it matches words, not meaning).
- **Occasional numeric misreadings can pass the validators.** In the recorded runs, 1 report of 440 read a percentage as a
  headcount ("the 40 missing attendees" when 20 of 50 were missing and 40 was the percentage). Wording can also be
  loose (for example "fell short of targets" when no target was supplied). So show **your own backend KPIs as the source of
  truth** and treat the AI text as a suggestion a human reviews. That is exactly what `pending_review` is for.
- Load, concurrency limits, long-running stability. The queue and duplicate memory are in memory.
- French is not a supported locale (`en` and `ar` only).

## 7. A prompt for your own Claude (copy and paste)

> You are integrating an existing, separately owned AI service into our Express/Prisma/pg-boss backend. Do NOT modify
> the AI service and do NOT rename any path, capability id, env var or the callback route. The repository is
> https://github.com/Diiaaax/fieldflow-ai (branch `feat/claims-validation`). Read, in this order: `docs/INTEGRATION-START-HERE.md`,
> `HANDOFF.md`, `openapi.yaml`, `docs/examples/`. First run `npm ci`, `npm test`, `npm run e2e`, `npm run contract:check`
> in that repo and tell me the exact results; if they all pass, the AI service is working and any later failure is in the
> wiring. Then build ONLY this milestone: one `supervisor_daily_summary` request -> `202` -> callback to
> `POST /api/v1/internal/ai/results` -> one `ai_suggestions` row (`pending_review`, unique on `request_id`) -> shown in the
> frontend. Handle the fallback report (`confidence` 0, `output.fallback`) and the `NEEDS_DATA`/`PII_FIREWALL` errors as normal stored
> results. Do not treat missing KPI keys or extra `output` keys as errors. If you think the AI service is wrong, first
> check section 4 ("not bugs") and section 5, then report the exact request, response, and the AI service log line. Do not
> claim anything works until you have run it.
