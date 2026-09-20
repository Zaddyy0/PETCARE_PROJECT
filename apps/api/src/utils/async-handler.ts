/**
 * Async route wrapper.
 *
 * Express 4 does not await route handlers, so a rejected promise inside one is
 * an unhandled rejection: the request hangs until the client times out, and in
 * recent Node versions the process itself may be torn down. Wrapping every
 * async handler routes rejections into `next()` and therefore into the central
 * error handler.
 *
 * Express 5 handles this natively. Keeping the wrapper costs nothing and means
 * the upgrade is not a prerequisite for correctness.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler<
  TParams = Record<string, string>,
  TBody = unknown,
  TQuery = unknown,
> = (
  req: Request<TParams, unknown, TBody, TQuery>,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<TParams = Record<string, string>, TBody = unknown, TQuery = unknown>(
  handler: AsyncRequestHandler<TParams, TBody, TQuery>,
): RequestHandler {
  return function wrapped(req, res, next) {
    /* `Promise.resolve` also tolerates a handler that is not actually async. */
    Promise.resolve(
      handler(req as Request<TParams, unknown, TBody, TQuery>, res, next),
    ).catch(next);
  } as RequestHandler;
}
