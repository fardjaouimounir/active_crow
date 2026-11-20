# Prompt 01 — Project Setup & Foundation

> Paste everything below this line into Claude Code, from the root of an empty Git repository that
> already contains `CLAUDE.md` and the `docs/` folder.

---

## 1. Context

You are starting the FieldFlow codebase. Read `CLAUDE.md` first; it defines the stack, folder layout,
conventions and hard rules for the whole project. The business documents in `docs/` are in Arabic and
are not needed in detail for this prompt.

This is wave 1 of 10. Nothing else exists yet. Everything you build here will be reused by every
later module, so favour clarity and correctness over breadth.

## 2. Objective

Create a working monorepo skeleton where:
- the API starts, logs structured JSON, returns errors in the agreed format and exposes a health endpoint;
- the web app starts in English and Arabic (RTL), and shows the API health status through the real
  data-fetching stack (Axios + TanStack Query);
- lint, formatting and tests run from the root, locally and in CI;
- a PostgreSQL instance for development and tests runs in Docker (not used by code yet).

## 3. Scope

In scope:
1. Root: npm workspaces (`apps/*`, `packages/*`), `"type": "module"`, `.nvmrc` (24), `.editorconfig`,
   `.gitignore`, `.env.example` files, ESLint (flat config) + Prettier shared by all workspaces,
   root scripts: `dev`, `lint`, `format`, `test`, `db:up`, `db:down`.
2. `docker-compose.dev.yml`: PostgreSQL 17 with two databases (`fieldflow_dev`, `fieldflow_test`),
   a named volume, a healthcheck, port bound to `127.0.0.1` only.
3. `packages/shared`: an ESM package exporting
   - `enums.js` — every enum listed in section "Enums" of `docs/04-database-design.md`, as frozen
     arrays plus Zod enums (e.g. `USER_ROLES`, `userRoleSchema`);
   - `errors.js` — error code constants: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`,
     `NOT_FOUND`, `CONFLICT`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMITED`, `INTERNAL_ERROR`;
   - `index.js` re-exporting both.
4. `apps/api` skeleton following `CLAUDE.md` §4–§6:
   - `config/env.js`: loads `.env` with dotenv, validates with Zod (`NODE_ENV`, `PORT`, `LOG_LEVEL`,
     `CORS_ORIGINS`, `DATABASE_URL`, `DATABASE_URL_TEST`), exits with a readable message if invalid.
   - `config/logger.js`: pino; pretty output only in development; redact `req.headers.authorization`,
     `req.headers.cookie`, `*.password`, `*.phone`.
   - `core/errors/`: `AppError` base + `ValidationError`(400), `UnauthenticatedError`(401),
     `ForbiddenError`(403), `NotFoundError`(404), `ConflictError`(409), `BusinessRuleError`(422);
     central `errorHandler` and `notFoundHandler` producing
     `{ error: { code, message, details?, requestId } }`; unknown errors log the stack and return a
     generic 500 message.
   - `core/http/`: `requestId` middleware (accepts a valid incoming `X-Request-Id` UUID or generates
     one, echoes it in the response header), `validate({ body, params, query })` middleware using Zod
     that replaces `req.body/params/query` with parsed values, response helpers `ok(res, data, meta)`
     and `created(res, data)`.
   - `app.js`: helmet, CORS restricted to `CORS_ORIGINS` with credentials, `express.json` with a
     1 MB limit, pino-http, requestId, a global rate limiter (300 req/min/IP), routes, 404, error handler.
   - `routes.js`: mounts `/api/v1`; `GET /api/v1/health` returns
     `{ data: { status: 'ok', version, uptimeSeconds } }`.
   - `server.js`: starts the server, handles SIGTERM/SIGINT gracefully (stop accepting, close server,
     exit), logs unhandled rejections.
   - Empty `modules/` folder with a `README.md` describing the module file pattern.
5. `apps/web` skeleton following `CLAUDE.md` §8:
   - Vite + React (JavaScript), Tailwind CSS, Lucide React.
   - Vite dev proxy: `/api` → `http://localhost:${API_PORT}`.
   - `shared/api/client.js`: Axios instance (`baseURL: '/api/v1'`, `withCredentials: true`) with a
     response interceptor that normalises errors to `{ code, message, details, requestId }`.
   - TanStack Query provider with sensible defaults (no retry on 4xx, 1 retry on network errors).
   - i18next with `en` and `ar` resources split per feature namespace; language switcher; sets
     `<html lang>` and `<html dir>`; persists the choice in `localStorage` inside try/catch.
   - React Router data router with three lazy-loaded layout shells: `/app`, `/field`, `/portal`,
     each rendering only its layout frame (header with language switcher, empty content area).
     `/` redirects to `/app`.
   - `/app` index page shows a status card fed by `useHealthQuery()` (in `features/system/api.js`):
     loading, healthy, and error states, all translated.
   - Shared UI primitives used by that page only: `Card`, `Spinner`, `ErrorState`. No other components yet.
6. Tests:
   - API: Vitest + Supertest — health returns 200 and the envelope; unknown route returns 404 in the
     error format with a `requestId`; `X-Request-Id` is echoed; `validate` middleware returns 400 with
     Zod issues in `details` (test it on a test-only router mounted in the test file, not in the app);
     an unexpected thrown error returns 500 with a generic message and no stack in the body.
   - Shared: enums match the values in `docs/04-database-design.md`.
   - Web: Vitest + Testing Library — the health card renders its three states (mock the hook, not Axios);
     switching to Arabic sets `dir="rtl"`.
7. CI: `.github/workflows/ci.yml` — Node 24, `npm ci`, lint, test (PostgreSQL service container even
   though unused yet, so later prompts only add migrations).
8. Root `README.md`: prerequisites, setup, commands. Update `CLAUDE.md` §10 if script names differ.

Out of scope (do not build): Prisma, database access, authentication, any business module, any page
other than the health card, Docker images for production, Caddy.

## 4. Technical Requirements

- ESM everywhere; no TypeScript files; JSDoc type hints are fine.
- Use the current stable major of each library; do not mix major versions across workspaces.
- ESLint rules: `no-console` (error, except in `server.js` bootstrap fallback), `no-unused-vars`,
  `import/no-cycle`, and `no-restricted-imports` blocking `apps/web` from importing `apps/api` and vice versa.
- `packages/shared` must have zero dependencies except `zod`.
- Ports: API 4000, web 5173 (configurable through env).

## 5. Database Changes

None. Only the Docker PostgreSQL service is created.

## 6. API Requirements

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | none | `200 { data: { status, version, uptimeSeconds } }` |
| any | unknown path | none | `404 { error: { code: 'NOT_FOUND', message, requestId } }` |

## 7. Frontend Requirements

- `/app` → layout + health card. `/field` and `/portal` → layout only.
- Header: product name, language switcher (EN / العربية).
- All visible strings come from i18n resources; no hard-coded UI text.
- Layout must look correct in both directions (check spacing and icon placement in RTL).

## 8. Business Rules

None in this prompt. Do not anticipate any.

## 9. Security Requirements

- helmet defaults; CORS only for configured origins; JSON body limit 1 MB.
- No secrets in the repo; `.env` ignored; `.env.example` documents every variable.
- Error responses never include stack traces or internal messages outside development.
- Logger redaction as listed in scope item 4.

## 10. Validation & Error Handling

- Invalid env → process exits with a clear list of the invalid keys.
- `validate()` error → 400 `VALIDATION_FAILED`, `details` = array of `{ path, message }`.
- Unknown error → 500 `INTERNAL_ERROR`, logged with `requestId`.

## 11. Testing Requirements

All tests listed in scope item 6 pass with `npm test` from the root. Tests must not depend on a
running API process (use Supertest on the Express app).

## 12. Acceptance Criteria

- [ ] `npm install && npm run db:up && npm run dev` starts API and web without errors.
- [ ] `curl localhost:4000/api/v1/health` returns the envelope and an `X-Request-Id` header.
- [ ] Opening the web app shows "API healthy"; stopping the API shows the translated error state.
- [ ] Switching to Arabic flips the layout to RTL with correct spacing.
- [ ] `npm run lint` and `npm test` pass; CI workflow is valid.
- [ ] No `.ts` files exist outside `node_modules`.

## 13. Expected Deliverables

- The file tree described above.
- Updated `README.md` and, if needed, `CLAUDE.md` §10.
- A final report listing: files created, library versions chosen, any deviation from this prompt and
  why, and the manual verification steps you ran.

Stop after the report. Do not start Prompt 02.
