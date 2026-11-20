# FieldFlow — Project Memory for Claude

This file is read at the start of every session. It is the contract for how this codebase is built.
If a prompt conflicts with this file, stop and ask before writing code.

## 1. What we are building

FieldFlow is a web platform for an Algerian field-marketing agency (Animation Commerciale). It replaces
WhatsApp groups, Excel files and paper with one system covering the whole campaign lifecycle:
campaign setup and rules → staffing and assignment → daily attendance and field visits → sales and
gift distribution → gift inventory reconciliation → Tombola → reporting and a client portal.

- MVP target: one agency runs one complete campaign end to end inside the system, demoed on a VPS.
- Built as single-agency first, but **every business table carries `agency_id`** so it can become SaaS later.
- AI features are built by another team and integrated later through APIs. **Do not build AI logic.**
  Only build the integration points described in `docs/` (e.g. `ai_flags`, `ai_suggestions`).

Reference documents (Arabic, authoritative for business rules):
- `docs/01-business-analysis.md` — actors, functional requirements (FR-xxx), business rules (BR-xx),
  edge cases (E-xx), decisions (section 12).
- `docs/04-database-design.md` — the approved database design (52 tables, enums, constraints).

When a prompt cites `BR-41` or `FR-070`, look it up in these files.

## 2. Hard rules (never break without asking)

1. JavaScript only. **No TypeScript files in our source** (`.ts`, `.tsx`). JSDoc comments are welcome.
2. Do not change the architecture, folder layout, libraries or conventions below unless the prompt says so.
3. Do not add features, tables, endpoints or screens that the current prompt did not ask for.
4. Do not rewrite or reformat existing code outside the scope of the current prompt.
5. No mock data in application code. Demo data lives only in seed scripts and is flagged `is_demo`.
6. Never trust the client: validate every input with Zod on the server; never accept `agency_id`,
   computed fields (gift entitlements, timestamps, totals) or ownership fields from the request body.
7. Every query on business data goes through the scope layer. Changing an ID in a URL must never expose
   another user's data (out-of-scope → 404, in scope but forbidden → 403).
8. Inventory, sales, attendance, Tombola and audit records are never hard-deleted. Corrections are new
   records (void, reversal, adjustment). Ledger tables are append-only (enforced by DB triggers).
9. Sensitive multi-table operations run in one database transaction.
10. Finish one module per prompt. When done, stop and report; do not start the next module.

## 3. Stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS, ESM (`"type": "module"`) |
| Repo | npm workspaces monorepo: `apps/api`, `apps/web`, `packages/shared` |
| API | Express, REST under `/api/v1` |
| DB | PostgreSQL 17+, Prisma ORM 7.x (driver adapter `@prisma/adapter-pg`), raw SQL migrations for constraints Prisma cannot express |
| Validation | Zod (shared schemas in `packages/shared`) |
| Auth | Email + password (argon2id), short-lived access JWT in memory, rotating refresh token in httpOnly cookie |
| Jobs | pg-boss (schema `pgboss`; enabled by `JOBS_ENABLED`) |
| Logging | pino + pino-http |
| API docs | OpenAPI 3.1 generated from shared Zod schemas |
| Files | `StorageAdapter` interface; `LocalDiskAdapter` now, S3-compatible later; images processed with sharp |
| Web | React (JS) + Vite, React Router (data router), TanStack Query + Axios, React Hook Form + Zod, TanStack Table, Recharts, Tailwind CSS, Lucide React, i18next |
| Tests | Vitest + Supertest against a real PostgreSQL test database (no DB mocks); Testing Library for UI |
| Deploy | Docker Compose on one VPS: Caddy (HTTPS + static) + api + postgres |

Use the current stable major of each library at install time, then pin via the lockfile. Do not
introduce another library for something this table already covers. Ask before adding a dependency
that is not listed here or in the prompt.

## 4. Repository layout

```
apps/api/src/
  app.js, server.js, routes.js
  config/          env (Zod-validated), logger, constants
  db/              prisma client, transaction helper
  core/            auth/, authz/, errors/, audit/, events/, storage/, jobs/, http/
  modules/<name>/  <name>.routes.js, .controller.js, .service.js, .repository.js,
                   .validators.js, .policies.js, .events.js, __tests__/
apps/api/prisma/   schema.prisma, migrations/, seed/, CONSTRAINTS.md
apps/web/src/
  app/             router, providers, layouts per surface
  shared/          api/, ui/, hooks/, i18n/
  features/<name>/ api.js (query keys + hooks), pages/, components/
  surfaces/        field/ (Animateur PWA), portal/ (client portal)
packages/shared/src/  enums, permissions, Zod schemas, error codes
docs/              business analysis and database design (Arabic)
```

## 5. Backend layering

| Layer | Does | Never |
| --- | --- | --- |
| Routes | wire path → middlewares (authenticate, requirePermission, validate) → controller | logic |
| Validators | Zod schemas for body / params / query (`.strict()`) | DB access |
| Controllers | read validated input, call one service method, shape the response | business rules, Prisma |
| Services | business rules (BR-xx), policies, transactions, audit, domain events | touch req/res |
| Repositories | Prisma / SQL queries; **require a `scope` argument** and apply it | business decisions |
| Policies | yes/no answers: can this actor do this to this record? | mutate data |

- A module never imports another module's repository; it calls that module's exported service.
- `agency_id` comes from `req.actor`, never from input.
- Domain events are published **after commit** only.
- Background jobs use `SYSTEM_SCOPE` explicitly; nothing else may.

## 6. API conventions

- Plural kebab-case resources, one nesting level max: `GET /campaigns/:id/assignments`.
- State transitions are explicit actions, never a PATCH of `status`: `POST /campaigns/:id/activate`.
- Lists: `?page&pageSize&sort&<filters>`, `pageSize` max 100.
- Success: `{ data, meta? }`. Error: `{ error: { code, message, details?, requestId } }`.
- Status codes: 400 validation · 401 unauthenticated · 403 forbidden · 404 not found / out of scope ·
  409 conflict (version, overlap) · 413 payload too large (`FILE_TOO_LARGE` for uploads, body too large) ·
  422 business rule violated · 429 rate limit · 500 internal (generic message).
- Error `code` values are UPPER_SNAKE constants in `packages/shared`; the web app translates them.
- Field-entry endpoints (sales, attendance, visits, stock confirmations) require an `Idempotency-Key` header.
- JSON is camelCase; dates ISO 8601 UTC; business dates `YYYY-MM-DD` in Africa/Algiers.
- Money (DZD, `numeric(14,2)`) travels as a decimal string (`"1250.00"`), never a JSON number. Inputs
  use the shared `moneySchema` (≥ 0, at most 2 decimals, ≤ 999 999 999 999.99; parsed to two decimals);
  repositories return Prisma `Decimal` values as `toFixed(2)` strings. Web forms accept localised input
  (`1 250,50`) through `moneyInputSchema` and display amounts with `Intl.NumberFormat` (currency DZD).

## 7. Database conventions

- `id uuid` PK (`gen_random_uuid()`), `created_at timestamptz`, `updated_at` on mutable tables only.
- snake_case in the DB via `@@map` / `@map`; camelCase in Prisma models and JS.
- Soft delete (`deleted_at`) only for reference data: clients, products, stock_items, points_of_sale, regions.
- Effective-dated rows use `valid_from` / `valid_to`.
- Constraints Prisma cannot express are added by hand-edited migrations and listed in `prisma/CONSTRAINTS.md`.
- Inventory is a double-entry ledger: every movement moves quantity from one location to another;
  `stock_balances` is updated in the same transaction after `SELECT … FOR UPDATE`.

## 8. Frontend rules

- Three surfaces in one app: `/app` (agency staff), `/field` (Animateur PWA, 4 screens), `/portal` (client).
  Each surface is lazy-loaded.
- No Axios calls inside components; use hooks from `features/*/api.js`.
- Filters live in the URL.
- All forms use React Hook Form + zodResolver with schemas from packages/shared.
- Access token in memory only; refresh via cookie on reload.
- UI languages: English and Arabic. Arabic is RTL. Use Tailwind logical utilities (`ms-*`, `me-*`,
  `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`) — never `ml-*`/`mr-*`/`left-*`/`right-*` for layout.
- Terminology: Arabic UI translates roles (منشط، مشرف، نقطة بيع); English UI keeps the French trade terms
  (Animateur, Superviseur, Point de Vente, Mécanisme).
- Numbers and dates via `Intl` in the active locale, timezone Africa/Algiers.
- Permissions hide UI elements via `useCan()`, but the backend is the only authority.

## 9. Definition of done (every prompt)

- `npm run lint` and `npm test` pass from the repo root.
- New endpoints have tests: happy path, validation error, out-of-scope (404), forbidden role (403).
- Business rules touched by the prompt have explicit tests named after the rule (e.g. `BR-41 …`).
- OpenAPI updated for new endpoints.
- No `console.log`, no commented-out code, no TODO without an issue reference.
- A short report: files created/changed, decisions taken, anything left out and why, how to verify manually.

## 9a. Token-efficient verification

- While working: `npm run test:related -- <changed files>` (dot reporter, silent, only the affected tests).
- At the end: `npm run verify` once (`lint:quick` + `test:quick`: quiet ESLint, dot reporter, stops at the
  first failure and still prints its full diff). CI runs the full `npm run lint` (with Prettier) and `npm test`.
- No verbose `npm test` unless a failure needs more detail, and then on that file only
  (`npx vitest run <file>` from its workspace).
- Quiet installs (`npm install --silent` / `--no-audit --no-fund`); pipe long outputs through `tail`.
- Never `cat` generated files, lockfiles or migrations unless the task needs them.
- On failure, read only the failing test and the code it exercises.
- Tests are silent by default (pino level `silent`, Prisma errors only); pass `LOG_LEVEL=debug` to see logs.

## 10. Commands (keep this section up to date)

```
npm install                 # install all workspaces
npm run dev                 # api + web in watch mode
npm run lint                # eslint + prettier check
npm run lint:quick          # eslint --quiet (errors only)
npm run format              # prettier write
npm test                    # all tests (vitest projects: api, web, shared)
npm run test:quick          # all tests, dot reporter, silent, stop at first failure
npm run test:related -- <files>  # only tests affected by the given files
npm run verify              # lint:quick + test:quick (end-of-task check)
npm run openapi            # write apps/api/openapi.json
npm run db:up               # start dev/test PostgreSQL (docker compose, waits until healthy)
npm run db:down             # stop it (data kept in the named volume)
npm run db:generate         # prisma generate (also runs automatically on npm install / npm ci)
npm run db:migrate          # prisma migrate dev (dev DB; must report no drift)
npm run db:migrate:deploy   # prisma migrate deploy (CI / production)
npm run db:reset            # drop, re-migrate and re-seed the dev DB
npm run db:seed             # reference data: 1 agency, 69 wilayas, 1,541 communes (idempotent)
npm run db:seed -- --demo   # demo organization; requires an active director and DEMO_PASSWORD
npm run db:bootstrap -- --email <e> --name "<n>"  # first director of the seeded agency (once; prints a temporary password)
npm run db:studio           # Prisma Studio
npm run db:seed:showcase    # demo campaign running for 10 days (attendance, sales, stock, visits, Tombola); needs DEMO_PASSWORD
npm run ai:start            # start ../fieldflow-ai with its own .env (port 4100)
npm run tombola:verify -- <draw.json>  # recompute a Tombola draw from its published data
```

API env for files: `UPLOAD_DIR` (default `./var/uploads` under `apps/api`, git-ignored; tests use a
temporary directory removed after the run) and `STORAGE_DRIVER` (`local`).

## 11. Decision log

| Date | Decision |
| --- | --- |
| 2026-11-19 | Single agency now, `agency_id` everywhere, SaaS later. |
| 2026-11-19 | Roles: director, general_manager, regional_manager, supervisor, animateur, client. |
| 2026-11-19 | Animateur works through a 4-screen PWA inside the web app (no native app in MVP). |
| 2026-11-19 | Supervisor is set per assignment, with a default supervisor per Animateur. |
| 2026-11-19 | Assignment = date range + optional shift + optional work days; one point of sale per day. |
| 2026-11-19 | Assignment approver is configurable per campaign (default regional_manager). |
| 2026-11-19 | Sales record quantity only (customer pays the store); no money in the system. |
| 2026-11-19 | Stock is per campaign, gifts and samples only; any level can hold stock. |
| 2026-11-19 | The client company runs the Tombola draw from the client portal; client portal is in MVP. |
| 2026-11-19 | Customer data anonymized 6 months after campaign close. Login by email + password, no OTP. |
| 2026-11-19 | Payroll is out of scope. Issues + announcements replace chat in MVP. |
| 2026-11-20 | Modular monolith, monorepo, Prisma 7, real-DB tests (see `docs/`). |
| 2026-11-20 | Customers belong to one campaign. No gift distribution without a confirmed holder balance. |
| 2026-11-20 | Algeria has 69 wilayas and 1,541 communes (Law 26-06, JO n° 25 of 5 April 2026). |
| 2026-11-20 | Prisma 7.10.x pinned (~7.10) with prisma-client-js (JS output); prisma-client generator rejected (TS-only output). |
| 2026-11-20 | Access tokens: `jose` (HS256, 15 min, claims sub/agencyId/role/clientId/tv/mcp). Refresh tokens: 32 random bytes, SHA-256 in `refresh_tokens`, rotated per use, reuse revokes the family. |
| 2026-11-20 | Passwords: `@node-rs/argon2` (argon2id, m=19 MiB, t=2, p=1; prebuilt binaries, no native build on Windows). Cookies parsed with `cookie-parser`. |
| 2026-11-20 | Files: `multer` (memory, per-kind limits), `file-type` (content sniffing), `sharp` (images → WebP q80, max 1600 px, EXIF-rotated, metadata stripped, 400 px thumbnail). Upload rules per kind in `packages/shared/src/files.js`. Reads go through `filePolicy()` → policy registered by the module owning the kind; unknown kind or denial ⇒ 404. File endpoints use Bearer auth only; the web app opens files through its `/files/:id` viewer route. |
| 2026-11-20 | Campaign codes `CMP-{YYYY}-{NNN}` per agency and start-date year, under a transaction advisory lock (READ COMMITTED). Coverage PUTs take an object body (`{ wilayas }`, `{ pointOfSaleIds }`, `{ productIds }`). |
| 2026-11-20 | Rules (Prompt 07): six fixed rule types with strict Zod schemas in `packages/shared/src/rules/` (attendance and customer_fields required for approval). Rule sets are versioned: an approved version is never edited (service-enforced; no DB trigger), approval takes effect at approval time and supersedes the previous version, a change is a new draft cloned from the approved one. `GET …/rule-sets/effective?at=` returns the version in force at any moment. |
| 2026-11-20 | Promotions: `evaluatePromotions` (shared, pure) gives ONE entitlement per promotion per sale (not per unit), from the highest tier reached; a product belongs to at most one promotion per rule set and an all-products promotion must be alone; `maxPerCustomer` is applied by the sales module, not here. The product scope is per promotion (stored on each tier row). |
| 2026-11-20 | Lifecycle: draft → planning → assigned → active ⇄ suspended → completed → closed, plus cancelled, only through `POST /campaigns/:id/<action>`; guards live in a registry (`registerTransitionGuard`) so later modules add blockers; activation only between start and end dates. Edit permissions per status are one pure matrix, `canEdit` in `packages/shared/src/campaignPolicy.js`, used by API and web. |
| 2026-11-20 | One injectable clock: `clock` / `now()` / `today()` in `packages/shared/src/time.js` (the API's `core/time/clock.js` re-exports the same object). Tests control time with `vi.spyOn(clock, 'now')`. |
| 2026-11-20 | Self-service auth routes (`/auth/me`, `/auth/logout`, …) use `anyAuthenticated()` instead of a catalog permission; the permission catalog is unchanged. |
| 2026-11-20 | In-app notifications store an event type and structured payload. The web app localizes the message. |
| 2026-11-20 | Inventory (Prompt 10): `modules/inventory/ledger.js` is the only code that writes ledger entries and balances (balance rows locked `FOR UPDATE` in location→item order; shortage ⇒ 422 `INSUFFICIENT_STOCK` with available/requested). Services decide, the engine posts. Approved adjustment ⇒ status `posted` (the enum has no `approved`); a movement's adjustment reason code is stored in `reference`; a dispute is resolved by one linked adjustment (`resolves_movement_id`), the disputed movement keeps status `disputed`. |
| 2026-11-20 | Idempotency (`core/http/idempotency.js`): `Idempotency-Key` UUID required on stock writes; the key row and the stored response are written in the business transaction; same key + other body/endpoint ⇒ 422 `IDEMPOTENCY_KEY_REUSED`; keys live 48 h (daily cleanup job). Sales and attendance reuse `requireIdempotencyKey` + `runIdempotent`. |
| 2026-11-20 | `inventoryService.distribute(tx, { actor, giftEntitlementId })` returns `{ ok:false, code:'INSUFFICIENT_STOCK' }` instead of throwing, so the sales transaction can mark the entitlement `undelivered`. |
| 2026-11-20 | absences voidable via voided_at (P11), partial unique on active rows |
| 2026-11-20 | P12: Stock shortage issues are unique per assignment and item while open or in progress. Undelivered entitlements keep their original shortage issue link after delivery or void. |
| 2026-11-20 | AI integration (Prompt 14b, `docs/ai-integration.md`): suggestion-only. `ai_requests` is ours (ids only in `label_map`); `ai_suggestions` is append-only except the review fields (trigger). Callback `/api/v1/internal/ai/results` is mounted in `app.js` before the JSON parser, service-key only (`GUARD.SERVICE`), 256 KB, 60/min, unknown `requestId` or capability mismatch ⇒ 422. Empty `AI_SERVICE_BASE_URL` disables the module. Missing target ⇒ omitted from payloads, 422 `AI_TARGET_REQUIRED`. |
| 2026-11-20 | Client portal and Tombola draw (Prompt 15, `docs/portal-and-tombola.md`): clients read only `/portal/*` (aggregates, no staff or customer data) plus the Tombola draw endpoints; the staff `/campaigns` read routes answer 404 to clients. Registration closing commits to the entry list in the database (`entries_hash`, `eligible_count`, `committed_at` by trigger); entries then freeze (`tombola_entries_frozen`). The draw is `hmac-sha256-fisher-yates-v1` in `packages/shared/src/tombolaDraw.js`, run once (unique `tombola_id`), the client or the director draws, the server random is revealed with the result. An unreachable winner gives the rank to the next reserve through `serves_rank`; voiding a sale with entries in a closed Tombola is refused. |
