/**
 * Test bootstrap.
 *
 * Every suite runs against a real MongoDB — an ephemeral in-memory one, not a
 * mock. That matters enormously here: the guarantees this codebase leans on
 * (partial unique indexes, duplicate-key errors, TTL behaviour) are *database*
 * behaviours. A mocked Mongoose would happily accept two appointments in the
 * same slot and the test would pass while production broke.
 *
 * The instance is started as a replica set so transactions are available,
 * matching Atlas rather than a bare `mongod`.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Register every schema, exactly as `src/index.ts` does at boot.
 *
 * `mongoose.models` only contains models whose module has been imported, so
 * without this the index-building step below would silently skip any model the
 * test file under execution happens not to import — and a test asserting that
 * an index exists would fail for a reason that has nothing to do with the code
 * it is testing.
 */
import '../src/models/index.js';

/* Set before any module reads it — `config/env.ts` validates at import time. */
process.env['NODE_ENV'] = 'test';
process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-that-is-long-enough-32';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-that-is-long-enough-32';
process.env['TOKEN_PEPPER'] ??= 'test-token-pepper-that-is-long-enough-3232';
process.env['MONGODB_URI'] ??= 'mongodb://127.0.0.1:27017';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  await mongoose.connect(replSet.getUri(), { dbName: 'pawsitive_test' });

  /**
   * Build indexes explicitly.
   *
   * `autoIndex` creates them lazily on first use, which would make an index a
   * test depends on absent for the very first assertion. Several tests here
   * exist specifically to prove an index works, so they must exist up front.
   */
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.createIndexes()),
  );
}, 120_000);

afterEach(async () => {
  /* Clear data between tests but keep indexes — dropping the database would
     destroy them and silently disable the constraints under test. */
  const collections = mongoose.connection.collections;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
