/**
 * Request validation.
 *
 * Every route that takes input runs through here with a schema from
 * `@pawsitive/shared` — the same schema the web client validates its forms
 * with. One definition, so the two can never disagree about what is valid.
 *
 * Validation is **whitelisting**, not checking. The parsed result replaces the
 * raw input, so a field the schema does not mention never reaches a service.
 * That is what stops mass assignment: a client that POSTs
 * `{"name":"Rex","ownerId":"<someone-else>","role":"super_admin"}` has the
 * unknown keys stripped before any code can spread them into a document.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ZodError } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validate and replace the named request segments.
 *
 * Errors are handed to `next()` so the central handler formats them — a
 * `ZodError` becomes a 400 with per-field messages the UI can pin to inputs.
 */
export function validate(schemas: ValidationSchemas) {
  return function validateRequest(req: Request, _res: Response, next: NextFunction): void {
    try {
      req.validated ??= {};

      if (schemas.params) {
        const parsed = schemas.params.parse(req.params);
        req.validated.params = parsed;
        /* `req.params` is a plain object and safe to overwrite. */
        req.params = parsed as typeof req.params;
      }

      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        req.validated.query = parsed;
        /**
         * In Express 5 `req.query` is a getter with no setter, so assigning to
         * it throws. Controllers read `req.validated.query`, which is the
         * coerced and whitelisted copy; we redefine the property too so any
         * code still reading `req.query` sees the clean version rather than
         * raw strings.
         */
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      if (schemas.body) {
        const parsed = schemas.body.parse(req.body);
        req.validated.body = parsed;
        req.body = parsed;
      }

      next();
    } catch (error) {
      next(error instanceof ZodError ? error : error);
    }
  };
}

/**
 * Typed accessors for the validated payload.
 *
 * `req.validated.body` is `unknown` by design — the middleware cannot know
 * which schema a given route used. These helpers let a controller state the
 * type once, at the top, rather than casting inline at every use:
 *
 *     const input = body<CreateAppointmentInput>(req);
 *
 * The cast is safe because the route wired the matching schema; centralising
 * it keeps the assertion visible and greppable instead of scattered.
 */
export function body<T>(req: Request): T {
  return req.validated?.body as T;
}

export function query<T>(req: Request): T {
  return req.validated?.query as T;
}

export function params<T>(req: Request): T {
  return req.validated?.params as T;
}
