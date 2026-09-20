/**
 * Application entry point.
 *
 * Kept deliberately thin: importing `./config/env.js` first means a
 * misconfigured environment fails here, before a database connection is
 * attempted or a port is bound, with a message naming every missing variable.
 */

import './config/env.js';
import { createApp } from './app.js';
import { logger } from './config/logger.js';
import { startServer } from './server.js';

/* Register every schema before the first query, so `populate()` across models
   cannot fail with MissingSchemaError depending on import order. */
import './models/index.js';

async function main(): Promise<void> {
  const app = createApp();
  await startServer(app);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start the Pawsitive API');
  process.exit(1);
});
