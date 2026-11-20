import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['test/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    // Explicit test environment so tests never depend on a local .env file (dotenv does not override these).
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      PORT: '4000',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://fieldflow:fieldflow@127.0.0.1:5432/fieldflow_dev',
      DATABASE_URL_TEST: 'postgresql://fieldflow:fieldflow@127.0.0.1:5432/fieldflow_test',
    },
  },
});
