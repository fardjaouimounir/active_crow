# FieldFlow reviewer guide

FieldFlow runs a field marketing campaign from staffing and attendance through sales, gift stock,
Tombola and reporting. The quick demo creates a fictional agency, one active campaign, four
Animateurs and three stores.

## Run locally

Install Git, Node.js 24 with npm, and Docker with Compose v2. Start Docker and run the following from
the repository root. Use a fresh local database for the demo.

```sh
git clone https://github.com/fardjaouimounir/active_crow.git fieldflow
cd fieldflow
```

```powershell
# Windows PowerShell
npm.cmd ci
Copy-Item .env.example .env
Copy-Item apps/api/.env.example apps/api/.env
```

```bash
# macOS or Linux
npm ci
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Copy the examples only on a fresh checkout. Generate a signing secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Edit these three values in `apps/api/.env`. Use the generated value for `JWT_ACCESS_SECRET` and
choose your own local `DEMO_PASSWORD`.

```dotenv
JWT_ACCESS_SECRET=
DEMO_MODE=true
DEMO_PASSWORD=
```

Then run:

```sh
npm run db:up
npm run db:migrate:deploy
npm run demo:reset -- --tiny
npm run demo:serve
```

On PowerShell, use `npm.cmd` if script execution is restricted. At the reset prompt, type `RESET`.
The seed prints `Done (0 call(s) refused…)` and lists all demo accounts. Keep the dev terminal open.
The default ports are `5432` for PostgreSQL, `4000` for the API, and `5173` for the web app. If you
change the database port in `.env`, update both database URLs in `apps/api/.env`.

## Walk through the demo

Open [FieldFlow](http://localhost:5173) and use the password you set in `DEMO_PASSWORD`. Open a
private window to try a second role without replacing the first session.

| Role | Example login | What to review |
| --- | --- | --- |
| Director | `director@demo.acticrew.test` | Open the active campaign and review staffing, attendance, stock and reporting. |
| Supervisor | `supervisor1@demo.acticrew.test` | Open the dashboard and inspect the team’s figures and attendance. |
| Animateur | `amina.benali@demo.acticrew.test` | Check the mobile field workspace and today’s activity. |
| Client | `client.najma@demo.acticrew.test` | Review campaign performance and the client-facing Tombola. |

Use [API health](http://localhost:4000/api/v1/health) to confirm `status: ok` and `db: up`. To run the
automated checks, keep PostgreSQL running and use `npm run verify`. Tests use `DATABASE_URL_TEST`.
To stop, press `Ctrl+C` in the dev terminal, then run `npm run db:down`.

## Optional AI evaluation

The app runs with blank AI settings. Live AI summaries require access to the separate `fieldflow-ai`
service and a model-provider key. See the [AI integration guide](ai-integration.md) for configuration
and the callback smoke test. The full showcase (`npm run demo:reset` without `--tiny`) prints
`Expected AI findings` for its longer campaign history.
