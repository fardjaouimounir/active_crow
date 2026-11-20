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
npm install

# Environment files: copy the examples, then adjust if needed
cp .env.example .env                    # PostgreSQL credentials for docker compose
cp apps/api/.env.example apps/api/.env  # API config (DATABASE_URL must match the root .env)
cp apps/web/.env.example apps/web/.env  # optional: API_PORT / WEB_PORT for the dev server

npm run db:up    # PostgreSQL 17 on 127.0.0.1:5432 with fieldflow_dev and fieldflow_test
npm run dev      # API on http://localhost:4000, web on http://localhost:5173
```

Open http://localhost:5173: the `/app` page shows the API health card. Use the EN / العربية switch
in the header to change language (Arabic switches the layout to right-to-left).

If port 5432 is already used (for example by a locally installed PostgreSQL), set another
`POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL` / `DATABASE_URL_TEST` in
`apps/api/.env`.

The `fieldflow_test` database is created only the first time the Docker volume is initialised. If
you started PostgreSQL before this script existed, run `docker compose -f docker-compose.dev.yml down -v`
(this deletes local data) and `npm run db:up` again.

## Commands

| Command           | What it does                                                   |
| ----------------- | -------------------------------------------------------------- |
| `npm run dev`     | API (`node --watch`) and web (Vite) in watch mode              |
| `npm run lint`    | ESLint + Prettier check over the whole repo                    |
| `npm run format`  | Prettier write                                                 |
| `npm test`        | All Vitest projects (api, web, shared)                         |
| `npm run db:up`   | Start the dev/test PostgreSQL container and wait until healthy |
| `npm run db:down` | Stop it (data is kept in the `postgres-data` volume)           |

Per workspace: `npm test -w @fieldflow/api`, `npm run build -w @fieldflow/web`, etc.

## Environment variables

| Variable            | Where           | Purpose                                                   |
| ------------------- | --------------- | --------------------------------------------------------- |
| `POSTGRES_USER`     | `.env`          | Local PostgreSQL user                                     |
| `POSTGRES_PASSWORD` | `.env`          | Local PostgreSQL password                                 |
| `POSTGRES_PORT`     | `.env`          | Host port (bound to 127.0.0.1 only)                       |
| `NODE_ENV`          | `apps/api/.env` | `development`, `test` or `production`                     |
| `PORT`              | `apps/api/.env` | API port (default 4000)                                   |
| `LOG_LEVEL`         | `apps/api/.env` | pino level (`info`, `debug`, `silent`, …)                 |
| `CORS_ORIGINS`      | `apps/api/.env` | Comma-separated origins allowed with credentials          |
| `DATABASE_URL`      | `apps/api/.env` | PostgreSQL connection string                              |
| `DATABASE_URL_TEST` | `apps/api/.env` | Test database (required when `NODE_ENV=test`)             |
| `API_PORT`          | `apps/web/.env` | Port the Vite dev proxy forwards `/api` to (default 4000) |
| `WEB_PORT`          | `apps/web/.env` | Vite dev server port (default 5173)                       |

The API refuses to start and lists every invalid variable when its configuration is wrong.

## API conventions (summary)

- Success: `{ data, meta? }`. Error: `{ error: { code, message, details?, requestId } }`.
- Every response carries an `X-Request-Id` header (a valid incoming UUID is reused).
- `GET /api/v1/health` → `{ data: { status: 'ok', version, uptimeSeconds } }`.
