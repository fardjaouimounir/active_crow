# Code Review Prompt — run after every module

> Paste below into a **new** Claude Code session (fresh context, so the reviewer did not write the code).
> Replace `<PROMPT FILE>` with the prompt that was just implemented, e.g. `prompts/prompt-02-database.md`.

---

You are reviewing work, not writing features. Do not modify any file unless I ask you to after the review.

Read `CLAUDE.md`, then `<PROMPT FILE>`, then the diff of the last module (`git diff <base>..HEAD`, or
the files listed in its final report). Review against the prompt and the project rules, in this order,
and stop at nothing: list every finding.

1. **Scope** — Everything in the prompt's Scope and Acceptance Criteria is implemented. Nothing outside
   it was added (extra endpoints, tables, screens, dependencies, refactors of unrelated code).
2. **Hard rules** (`CLAUDE.md` §2) — no TypeScript source, no mock data in app code, no trusted client
   fields (`agency_id`, computed values, owners), no hard deletes of ledger/field records, transactions
   around multi-table writes.
3. **Authorization** — every new route has `authenticate` + `requirePermission`; every repository call
   passes a scope; out-of-scope returns 404, forbidden returns 403. Try to think of one URL or body
   manipulation that leaks or modifies another user's data; if you find one, it is critical.
4. **Business rules** — each BR/FR the prompt cites is enforced in the service (and in the database where
   the design says so) and has a test named after it. Check edge cases from `docs/01-business-analysis.md`
   section 8 that touch this module.
5. **Data integrity** — concurrency (two requests at once), idempotency on field endpoints, row locking
   on balances, events emitted after commit only, audit entries written in the same transaction.
6. **Layering** — controllers thin, no Prisma outside repositories, no cross-module repository imports,
   validators strict.
7. **API contract** — paths, status codes, envelope, error codes, pagination match `CLAUDE.md` §6;
   OpenAPI updated.
8. **Frontend** (if touched) — no Axios in components, all strings translated in EN and AR, RTL-safe
   utilities only, loading/empty/error states present, permissions via `useCan()`.
9. **Tests** — they test behaviour, not implementation; they would fail if the rule were removed;
   they use the real test database. Run `npm run lint` and `npm test` and report the result.
10. **Code quality** — duplication, dead code, unclear names, missing error handling, leftover logs/TODOs.

Output format:

| # | Severity | File:line | Finding | Why it matters | Suggested fix |
| --- | --- | --- | --- | --- | --- |

Severity: **critical** (security, data loss, wrong money/stock numbers) · **major** (rule not enforced,
missing test for a cited rule, scope violation) · **minor** (quality, naming, small gaps).

End with: a verdict (`accept` / `accept after fixes` / `reject`), and the exact list of fixes required
before acceptance. Do not fix anything yet.
