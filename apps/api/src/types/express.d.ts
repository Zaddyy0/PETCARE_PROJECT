/**
 * Express request augmentation.
 *
 * Everything the middleware chain attaches to a request is declared here, so a
 * controller reading `req.auth.userId` gets real type checking instead of
 * `any`. The alternative — casting at each use — means a renamed field fails
 * silently at runtime rather than loudly at compile time.
 */

import type { Permission, Role } from '@pawsitive/shared';
import type { Types } from 'mongoose';
import type { UserDocument } from '../models/user.model.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Present on every request, authenticated or not. Echoed in the response
       * body and every log line, so a user's screenshot of an error can be
       * traced to the exact request that produced it.
       */
      requestId: string;

      /**
       * Present only after `authenticate` has run.
       *
       * Optional on purpose: a public route genuinely has no auth, and making
       * it non-optional would force every handler to assert it exists. Handlers
       * behind `authenticate` use `requireAuth(req)` from `auth-context.ts`,
       * which narrows the type and throws if it is somehow absent.
       */
      auth?: AuthContext;

      /** The full user document, loaded once by `authenticate` and reused. */
      currentUser?: UserDocument;

      /** Populated by `validate()` from the Zod schema, already coerced. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export interface AuthContext {
  userId: Types.ObjectId;
  role: Role;
  /** Null for clients and super admins, who are not scoped to one clinic. */
  clinicId: Types.ObjectId | null;
  /** The doctor profile id, present only when `role === 'doctor'`. */
  doctorId: Types.ObjectId | null;
  /** Session id from the JWT `sid` claim, for targeted revocation. */
  sessionId: string;
  permissions: ReadonlySet<Permission>;
  /** Set when a super admin is acting as this user. Always audited. */
  impersonatorId: Types.ObjectId | null;
}

export {};
