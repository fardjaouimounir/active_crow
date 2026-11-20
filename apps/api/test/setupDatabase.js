// Runs in every API test file: starts from empty business tables and releases the pool at the end.
import { afterAll, beforeAll } from 'vitest';
import { disconnectDatabase } from '../src/db/client.js';
import { truncateBusinessTables } from './helpers/database.js';

beforeAll(async () => {
  await truncateBusinessTables();
});

afterAll(async () => {
  await disconnectDatabase();
});
