# API modules

One folder per business module (e.g. `campaigns/`, `assignments/`). No module exists yet.

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
