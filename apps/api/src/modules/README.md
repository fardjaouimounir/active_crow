# API modules

One folder per business module (e.g. `campaigns/`, `assignments/`). `auth/` is the first one.

```
modules/<name>/
  <name>.routes.js       path → authenticate → requirePermission → validate → controller
  <name>.validators.js   Zod schemas for body / params / query (.strict())
  <name>.controller.js   reads validated input, calls one service method, shapes the response
  <name>.service.js      business rules (BR-xx), policies, transactions, audit, domain events
  <name>.repository.js   Prisma / SQL queries; every function takes a `scope` argument
  <name>.policies.js     yes/no answers: can this actor do this to this record?
  <name>.events.js       domain event names and payload builders (published after commit)
  __tests__/             Vitest + Supertest, against the real test database
```

Rules (see `CLAUDE.md` §5–§6):

- A module never imports another module's repository; it calls that module's exported service.
- `agency_id` comes from `req.actor`, never from the request.
- Controllers respond with `ok(res, data, meta)` / `created(res, data)` from `core/http`.
- Errors are thrown as `AppError` subclasses from `core/errors`; never build error JSON by hand.
- Register the module router in `src/routes.js` under `/api/v1`.

## Route guards (deny by default)

Every route is either `publicRoute()` (and listed in `test/routeGuards.test.js`) or
`authenticate` followed by `requirePermission(...)` (all listed permissions required) or, for
self-service endpoints every role may call, `anyAuthenticated()`. The route audit test walks the
Express router stack and fails on any other route.

```js
router.get(
  '/:id',
  authenticate,
  requirePermission('campaign.read'),
  validate(schemas),
  controller.get,
);
```

`authenticate` reloads the user on every request (status, role, token_version) and sets a frozen
`req.actor`; it also blocks every route but `GET /auth/me`, `POST /auth/change-password` and
`POST /auth/logout` while the user must change their password.

## Data scope in repositories

The controller resolves the scope once (`ScopeService.forRequest(req)`, cached per request) and
passes it down; services pass it to repositories. Repositories build every query on business data
from a builder in `core/authz/scopeFilters.js` combined with their own filter through `scoped()`:

```js
// campaigns.repository.js
import { campaignWhere, scoped } from '../../core/authz/index.js';

export function findCampaign(scope, id, db = prisma) {
  return db.campaign.findFirst({ where: scoped(campaignWhere(scope), { id }) });
}

// campaigns.service.js
const campaign = await repository.findCampaign(scope, id);
if (!campaign) throw new NotFoundError(); // out of scope and missing look the same (404)
```

- A record outside the scope is **not found** (404), never forbidden: changing an id in a URL
  reveals nothing. A record in scope that the actor may not change is 403 (a policy decision).
- Builders throw without a valid scope and always filter on `agencyId`.
- `userWhere(scope, { at })` is async (reporting tree via a recursive CTE). Pass the business date
  of the record being read as `at`, so a supervisor keeps seeing an Animateur's records from the
  period they supervised them.
- New resources add `<resource>Where(scope)` to `scopeFilters.js` following the same pattern.
- `SYSTEM_SCOPE` (unrestricted) is for background jobs only.

## Audit

Write paths record audit rows with `auditService.record(tx, { actor, action, entityType, entityId,
before, after, req })` **inside the same transaction** as the change. Passwords, hashes and tokens
are stripped from `before` / `after`. Action names: `<module>.<past_tense_verb>`.
