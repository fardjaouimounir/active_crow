# fieldflow-ai

Standalone AI service for FieldFlow. It exposes four capabilities through explicit
POST routes and posts results back to FieldFlow's internal results endpoint.

**Rules (non-negotiable):**
- The model writes prose only. All numbers are computed in code (`src/pipeline/kpis.js`).
- Every result is a suggestion. FieldFlow stores it as `pending_review`; a human accepts or rejects.
- No customer/employee names, phones, EXIF or raw photos cross the boundary. Labels like `A1` and `PDV-031` only.
- AI Grid is the provider (`LLM_BASE_URL=https://app.ai-grid.io/v1`, OpenAI Chat
  Completions). The only model is `Qwen/Qwen3.8-27B`. On failure the service uses
  a deterministic templated fallback — no other model, no training.

## Run

```bash
npm install
cp .env.example .env   # then fill in the keys
npm start
```

## Capabilities

| Route | Subject | Output |
|---|---|---|
| `POST /v1/supervisor_daily_summary` | supervisor | headline, summary, attention, recommendedActions, kpis |
| `POST /v1/sales_performance` | campaign | ranking, trends, anomalies, recommendedActions, kpis |
| `POST /v1/campaign_insights` | campaign | narrative, risks, opportunities, decisions, kpis |
| `POST /v1/animateur_coaching` | campaign | coaching[] by label, campaignActions[], kpis |

## Test / demo

```bash
npm test                    # full test suite (stubs, no network)
npm run demo -- --capability supervisor_daily_summary --locale ar
npm run smoke:local         # real AI Grid call to Qwen (needs .env)
npm run e2e                 # full chain over HTTP: /health -> Qwen -> callback
npm run mock:callback       # optional: stand-in for the backend results route
```

`npm run e2e` starts an in-process service plus a mock receiver on port 3100 and
verifies the callback path, auth, `requestId`, `capability` and KPIs end-to-end.
No keys are printed. If you prefer a separately running receiver, start
`npm run mock:callback` first and POST fixtures to `http://127.0.0.1:4100/v1/{capability}`
with `Authorization: Bearer <AI_SERVICE_INBOUND_KEY>`.

## Contract

See `openapi.yaml`. Request and callback shapes match the FieldFlow Phase 3 contract:
pg-boss → `POST /v1/{capability}` → this service → `POST /api/v1/internal/ai/results`
(Bearer service key) → `ai_suggestions` row with `pending_review`.
See `HANDOFF.md` for the complete backend integration task.

## Deploy (container, internal network)

```bash
# once, on the VPS:
docker network create fieldflow_internal

# on this host: fill .env with the FRESH rotated key and the matching shared
# service keys. FIELDFLOW_API_BASE_URL must be the API's INTERNAL URL.
docker compose up -d --build
docker compose ps
docker compose logs -f ai
curl http://127.0.0.1:4100/health   # -> {"ok":true}
```

- The image runs as an unprivileged user and needs no curl: the healthcheck
  uses Node's built-in `fetch` against the public `GET /health` route.
- `.env` is excluded by `.dockerignore` — secrets are injected at runtime only.
- If your backend's internal network has a different name, change the single
  `networks.internal.name` value in `compose.yaml` and attach the API container
  to the same network.
- The loopback `ports` mapping is for local debugging; remove it on the VPS if
  only the backend needs access.

## Key rotation

Keys pasted in chat are compromised. Rotate the AI Grid key and any GitHub token
before sharing this repo or its history.

## Real Qwen check

```bash
npm run qwen:check   # needs .env with the real LLM_API_KEY; prints pass/fail only, never keys or text
```

Output is accepted only if Qwen's reply parses (think tags, fences and surrounding text are
handled), matches the schema, every entity label it uses (in prose and in `refs` / `evidence` /
`evidenceRefs`) appears in the request data, and every number is in the allow-list built from the
request (KPIs, input figures, code-computed per-entity gaps). One repair retry is made; after that the
deterministic template is returned with `modelVersion` `...@deterministic-fallback...`,
`confidence` 0 and `output.fallback.reasonCode` explaining why. Only `ar` and `en` are supported.

## Business accuracy

Code calculates what happened; the model explains it; evaluation checks the explanation.

- A metric that cannot be computed (missing input, zero denominator) is **omitted** from
  `output.kpis`, never reported as 0. `output.dataQuality` lists code-detected data problems
  (impossible values, duplicates, missing targets...); the prompt requires the report to state them.
- Findings (value vs target, vs previous period, vs plan, highest / lowest) are detected in code and
  ranked; the model writes typed claims about them (observation, interpretation, hypothesis,
  recommendation) that code renders into the report fields. `output.insights` shows the provenance.
  `OUTPUT_MODE=legacy` is the rollback switch.
- `npm run eval:recorded` / `npm run eval:live` run the offline 45-scenario benchmark; see
  `eval/README.md` and `eval/BASELINE.md`.

## Claim validation

A cause is a hypothesis unless the data states it. The service validates every claim and the headline
in code (causal wording, invented metrics or roles, labels and figures not in the cited findings,
contradictions with findings, unacknowledged data conflicts) in English, Arabic and French. One repair
retry, then the offending claims are removed and the AI report is still delivered. Optional
`data.causes` (opaque codes) is the only way to state a cause as fact. See `docs/claim-validation.md`.
