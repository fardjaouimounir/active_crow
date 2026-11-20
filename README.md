# FieldFlow

Field-marketing campaign platform for an Algerian Animation Commerciale agency: campaign setup,
staffing, attendance and visits, sales and gift distribution, inventory, Tombola, reporting and a
client portal.

Project rules, stack and conventions: [`CLAUDE.md`](CLAUDE.md). Business analysis and database
design (Arabic): [`docs/`](docs/). Build prompts and the working method:
[`prompts/README.md`](prompts/README.md).

## Repository

```
apps/api          Express REST API (/api/v1)
apps/web          React + Vite web app: /app (staff), /field (Animateur PWA), /portal (client)
packages/shared   Enums, error codes and Zod schemas shared by api and web
docker/           Local PostgreSQL init scripts
```

## Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`) and npm 11
- Docker with Docker Compose v2 (for the local PostgreSQL 17)

## Setup

```sh
npm install      # also generates the Prisma client (postinstall)

# Environment files: copy the examples, then adjust if needed
cp .env.example .env                    # PostgreSQL credentials for docker compose
cp apps/api/.env.example apps/api/.env  # API config (DATABASE_URL must match the root .env)
cp apps/web/.env.example apps/web/.env  # optional: API_PORT / WEB_PORT for the dev server

npm run db:up       # PostgreSQL 17 on 127.0.0.1:5432 with fieldflow_dev and fieldflow_test
npm run db:migrate  # apply migrations to fieldflow_dev
npm run db:seed     # 1 agency, 69 wilayas, 1,541 communes
npm run db:bootstrap -- --email you@example.com --name "Your Name"   # first director
npm run dev         # API on http://localhost:4000, web on http://localhost:5173
```

`apps/api/.env` needs a `JWT_ACCESS_SECRET` of at least 32 characters (see `.env.example` for a
one-line generator). `db:bootstrap` prints a temporary password once; it refuses to run when the
agency already has a director.

Open http://localhost:5173 and sign in with that email and temporary password: you are asked to
choose a new password, then land on `/app` (the API and database health card) with your name and
role in the header. Animateurs land on `/field`, client users on `/portal`. Use the EN / العربية
switch to change language (Arabic switches the layout to right-to-left).

Tests use `fieldflow_test` (`DATABASE_URL_TEST`): `npm test` applies the migrations to it
automatically and empties the business tables before each API test file.

Database notes: [`apps/api/prisma/README.md`](apps/api/prisma/README.md) (Prisma setup),
[`apps/api/prisma/CONSTRAINTS.md`](apps/api/prisma/CONSTRAINTS.md) (hand-written constraints and
their tests).

If port 5432 is already used (for example by a locally installed PostgreSQL), set another
`POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL` / `DATABASE_URL_TEST` in
`apps/api/.env`.

The `fieldflow_test` database is created only the first time the Docker volume is initialised. If
you started PostgreSQL before this script existed, run `docker compose -f docker-compose.dev.yml down -v`
(this deletes local data) and `npm run db:up` again.

## Commands

| Command                     | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `npm run dev`               | API (`node --watch`) and web (Vite) in watch mode               |
| `npm run lint`              | ESLint + Prettier check over the whole repo                     |
| `npm run format`            | Prettier write                                                  |
| `npm test`                  | All Vitest projects (api, web, shared)                          |
| `npm run db:up`             | Start the dev/test PostgreSQL container and wait until healthy  |
| `npm run db:down`           | Stop it (data is kept in the `postgres-data` volume)            |
| `npm run db:generate`       | Regenerate the Prisma client (runs on install too)              |
| `npm run db:migrate`        | `prisma migrate dev` on the dev database (must report no drift) |
| `npm run db:migrate:deploy` | `prisma migrate deploy` (CI, production)                        |
| `npm run db:reset`          | Drop, re-migrate and re-seed the dev database                   |
| `npm run db:seed`           | Reference data: agency, 69 wilayas, 1,541 communes (idempotent) |
| `npm run db:bootstrap`      | First director of the seeded agency (`-- --email … --name "…"`) |
| `npm run db:studio`         | Prisma Studio                                                   |

Per workspace: `npm test -w @fieldflow/api`, `npm run build -w @fieldflow/web`, etc.

## Environment variables

| Variable                 | Where           | Purpose                                                                                                 |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`          | `.env`          | Local PostgreSQL user                                                                                   |
| `POSTGRES_PASSWORD`      | `.env`          | Local PostgreSQL password                                                                               |
| `POSTGRES_PORT`          | `.env`          | Host port (bound to 127.0.0.1 only)                                                                     |
| `NODE_ENV`               | `apps/api/.env` | `development`, `test` or `production`                                                                   |
| `PORT`                   | `apps/api/.env` | API port (default 4000)                                                                                 |
| `LOG_LEVEL`              | `apps/api/.env` | pino level (`info`, `debug`, `silent`, …)                                                               |
| `CORS_ORIGINS`           | `apps/api/.env` | Comma-separated origins allowed with credentials                                                        |
| `DATABASE_URL`           | `apps/api/.env` | PostgreSQL connection string                                                                            |
| `DATABASE_URL_TEST`      | `apps/api/.env` | Test database (required when `NODE_ENV=test`)                                                           |
| `JWT_ACCESS_SECRET`      | `apps/api/.env` | HS256 key for access tokens (≥ 32 characters, required)                                                 |
| `ACCESS_TOKEN_TTL`       | `apps/api/.env` | Access-token lifetime (`15m` default; s, m or h)                                                        |
| `REFRESH_TOKEN_TTL_DAYS` | `apps/api/.env` | Refresh-token lifetime in days (default 7)                                                              |
| `COOKIE_SECURE`          | `apps/api/.env` | `true`/`false`; unset = Secure except in development                                                    |
| `UPLOAD_DIR`             | `apps/api/.env` | Uploaded files (default `./var/uploads`, relative to `apps/api`; git-ignored; never under the web root) |
| `STORAGE_DRIVER`         | `apps/api/.env` | Storage adapter; only `local` for now                                                                   |
| `SEED_AGENCY_NAME`       | `apps/api/.env` | Name of the agency created by `db:seed`                                                                 |
| `SEED_AGENCY_CODE`       | `apps/api/.env` | Its code (`^[A-Z0-9-]{2,20}$`)                                                                          |
| `API_PORT`               | `apps/web/.env` | Port the Vite dev proxy forwards `/api` to (default 4000)                                               |
| `WEB_PORT`               | `apps/web/.env` | Vite dev server port (default 5173)                                                                     |

The API refuses to start and lists every invalid variable when its configuration is wrong.

## API conventions (summary)

- Success: `{ data, meta? }`. Error: `{ error: { code, message, details?, requestId } }`.
- Every response carries an `X-Request-Id` header (a valid incoming UUID is reused).
- `GET /api/v1/health` → `200 { data: { status: 'ok', db: 'up', version, uptimeSeconds } }`, or
  `503` with `status: 'degraded', db: 'down'` when PostgreSQL is unreachable.

## Authentication (summary)

| Method | Path                           | Auth                 | Success                                                     |
| ------ | ------------------------------ | -------------------- | ----------------------------------------------------------- |
| POST   | `/api/v1/auth/login`           | public, rate-limited | `200 { data: { accessToken, expiresIn, user } }` + `ff_rt`  |
| POST   | `/api/v1/auth/refresh`         | `ff_rt` cookie only  | same as login, cookie rotated                               |
| POST   | `/api/v1/auth/logout`          | access token         | `204`, this browser's refresh token revoked, cookie cleared |
| POST   | `/api/v1/auth/logout-all`      | access token         | `204`, every session of the user revoked                    |
| POST   | `/api/v1/auth/change-password` | access token         | `200` new session; other sessions revoked                   |
| GET    | `/api/v1/auth/me`              | access token         | `200 { data: { user, permissions } }`                       |

- The access token (15 min) is kept in memory by the web app and sent as `Authorization: Bearer`.
  The refresh token (7 days) lives only in the `ff_rt` cookie (`HttpOnly; Secure; SameSite=Strict;
Path=/api/v1/auth`). Presenting a refresh token twice revokes its whole session family.
- Wrong email, wrong password and suspended accounts get the same `401 INVALID_CREDENTIALS`;
  login is limited to 5 attempts per minute per IP + email (`429 RATE_LIMITED`).
- While `mustChangePassword` is set, every route but `me`, `change-password` and `logout` answers
  `403 PASSWORD_CHANGE_REQUIRED`.
- Permissions per role: `packages/shared/src/permissions.js` (used by the API and by `useCan()`).

When the API is behind Caddy, set `TRUST_PROXY=1` so rate limits use the client IP. Leave it at `false` for direct connections.

Run `npm run openapi` to generate `apps/api/openapi.json`. In development, browse the API at `/api/docs` or fetch the JSON at `/api/docs/openapi.json`.
