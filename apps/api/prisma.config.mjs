// Prisma CLI configuration (Prisma 7 no longer reads the connection URL from schema.prisma).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed/index.js',
  },
  datasource: {
    // Read directly (not through `env()`, which throws) so that `prisma generate` — run by
    // postinstall in CI and Docker builds — works without a database URL.
    url: process.env.DATABASE_URL ?? '',
  },
});
