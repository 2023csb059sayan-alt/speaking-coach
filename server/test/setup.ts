/**
 * Test setup: database lifecycle only.
 *
 * Environment variables live in vitest.config.ts. ES module imports are hoisted, so
 * assignments in this file body would run after the modules under test had already
 * read process.env, which produced a confusing mix of real and test configuration.
 *
 * The database is a dedicated database on the local MongoDB server. Set
 * TEST_MONGODB_URI / TEST_MONGODB_DB to point somewhere else if you do not run
 * mongod locally.
 */

import { afterAll, beforeAll } from 'vitest';
import { connectDb, disconnectDb } from '../src/db/connect';
import { resetGovernor } from '../src/services/quota/governor';
import { resetClock } from '../src/services/quota/clock';

beforeAll(async () => {
  await connectDb();
});

afterAll(async () => {
  resetGovernor();
  resetClock();
  await disconnectDb();
});
