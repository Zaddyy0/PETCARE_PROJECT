/**
 * `@pawsitive/shared` — the contract between the API and the web client.
 *
 * Anything imported by both sides belongs here: domain enums, wire types,
 * validation schemas, business constants and pure domain logic. Anything that
 * touches a database, a request object, the DOM or a secret does not.
 *
 * The rule that keeps this package honest: **no runtime dependency except Zod.**
 * The moment it imports Mongoose it stops being shareable with the browser, and
 * the moment it imports React it stops being usable on the server.
 */

/* Enumerations and the role model ------------------------------------------ */
export * from './enums.js';

/* Authorization policy ------------------------------------------------------ */
export * from './permissions.js';

/* Error catalogue ----------------------------------------------------------- */
export * from './errors.js';

/* Business rules ------------------------------------------------------------ */
export * from './constants.js';

/* Wire types ---------------------------------------------------------------- */
export * from './types/common.js';
export * from './types/user.js';
export * from './types/pet.js';
export * from './types/appointment.js';
export * from './types/medical.js';
export * from './types/review.js';
export * from './types/notification.js';
export * from './types/analytics.js';
export * from './types/audit.js';

/* Validation contracts ------------------------------------------------------ */
export * from './schemas/common.schema.js';
export * from './schemas/auth.schema.js';
export * from './schemas/user.schema.js';
export * from './schemas/pet.schema.js';
export * from './schemas/appointment.schema.js';
export * from './schemas/medical.schema.js';
export * from './schemas/review.schema.js';
export * from './schemas/analytics.schema.js';

/* Pure domain logic --------------------------------------------------------- */
export * from './utils/datetime.js';
export * from './utils/slots.js';
export * from './utils/appointment.js';
export * from './utils/format.js';
