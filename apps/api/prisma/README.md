# Prisma in a JavaScript-only project

## Decision (Prompt 02, Step 0)

FieldFlow uses **Prisma 7.10.x with the `prisma-client-js` generator** and the
`@prisma/adapter-pg` driver adapter.

| Requirement                                                              | How it is met                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Application code is `.js` ESM and imports the client normally            | `import { PrismaClient } from '@prisma/client'` works from ESM (verified on Node 24.11)                       |
| No `.ts` file committed or maintained by us                              | The client is generated as `.js` (+ `.d.ts` typings) into `node_modules/.prisma/client`, which is git-ignored |
| `npm run db:generate` is one command, no TypeScript toolchain at runtime | `prisma generate` emits plain JavaScript and a WASM query compiler; nothing is compiled afterwards            |

Configuration lives in `apps/api/prisma.config.mjs` (JavaScript), which loads `.env` through
`dotenv/config` and gives the CLI `DATABASE_URL`. Prisma 7 no longer reads the URL from
`schema.prisma`.

## Options considered

1. **`prisma-client` generator with a JavaScript output option.** Not available: in 7.10.1 its
   `generatedFileExtension` only accepts `ts`, `mts` or `cts`.
2. **Legacy `prisma-client-js` generator. Chosen.** Still shipped and supported in 7.10.1 (the CLI
   lists it as "Legacy Prisma Client JS"). It works with driver adapters and the Rust-free query
   compiler.
3. **Generate the TypeScript client into a git-ignored folder and compile it with esbuild.** Works,
   but adds a build step and a dependency. This is the fallback if a future Prisma release drops
   `prisma-client-js`.

## Proof

A throwaway script ran on Node 24 against the Docker PostgreSQL:

```js
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
await prisma.$queryRaw`SELECT 1 AS ok`; // → [{ ok: 1 }], PostgreSQL 17.12
```

## Consequences

- The client is generated automatically by the `postinstall` script of `apps/api` on every
  `npm install` / `npm ci` (local, CI, Docker). `npm run db:generate` regenerates it by hand, and
  `prisma migrate dev` regenerates it after each migration. Generation does not need a database.
- Only `src/db/client.js` imports `@prisma/client` (enforced by ESLint; the seed script and the
  database tests are the only exceptions). Repositories receive the client from there.

## Prisma 8 migration path

`prisma-client-js` is marked legacy and Prisma 8 may remove it, so Prisma stays pinned to `~7.10`
until this is revisited. If it is removed, the fallback is:

1. Switch to the `prisma-client` generator with `output` pointing to a git-ignored folder
   (for example `apps/api/generated/prisma`).
2. Make `db:generate` run `prisma generate` and then compile that TypeScript output to JavaScript with
   esbuild into the same git-ignored folder (build artefact only; nothing is committed).
3. Change the single import in `src/db/client.js` to the compiled output.

Application code does not change, because only `src/db/client.js` imports the client and every
repository goes through it.

## Known advisories

Checked on 2026-11-20 with `npm audit`: **3 high** findings, all from one root cause.

| Package           | Advisory                                                                                                                    | Path                                   | Assessment                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `effect` ≤ 3.22.0 | ReDoS in `Schema.TemplateLiteral` compiled regex ([GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)) | `prisma` → `@prisma/config` → `effect` | Dev-only: used by the Prisma CLI to load `prisma.config.mjs`. Not part of the runtime client, and no untrusted input reaches it. |

`npm audit fix --force` would downgrade to Prisma 6, which breaks the approved stack, so it is not
applied. Re-check when upgrading Prisma.
