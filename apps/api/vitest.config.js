import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['test/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    // Applies migrations to DATABASE_URL_TEST once per run.
    globalSetup: ['./test/globalSetup.js'],
    // Per file: truncate business tables before, disconnect after.
    setupFiles: ['./test/setupDatabase.js'],
    // Test files share one real database, so they run one at a time.
    fileParallelism: false,
    // DATABASE_URL / DATABASE_URL_TEST come from apps/api/.env locally and from the job env in CI
    // (dotenv never overrides variables that are already set). Logs are silent in tests unless
    // LOG_LEVEL is passed explicitly, e.g. `LOG_LEVEL=debug npm test` (see src/config/env.js).
    env: {
      NODE_ENV: 'test',
    },
  },
});
