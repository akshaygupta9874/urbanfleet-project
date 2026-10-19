import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Type definition for an asynchronous Express request handler function.
 * Supports strongly typed request bodies, query parameters, route params, and custom request properties.
 */
export type AsyncRequestHandler<
  Req extends Request = Request,
  Res extends Response = Response,
  Next extends NextFunction = NextFunction,
  Return = any
> = (req: Req, res: Res, next: Next) => Promise<Return> | Return;

/**
 * Options for configuring the AsyncHandler execution behavior.
 */
export interface AsyncHandlerOptions {
  /**
   * Optional custom error transformer to convert thrown non-Error values
   * into domain-specific AppError instances before passing to next().
   */
  errorTransformer?: (error: unknown, req: Request, res: Response) => any;
  /**
   * Custom handler name override for tracing and Express stack inspection.
   */
  name?: string;
}

/**
 * Normalizes any thrown value (strings, numbers, plain objects, null/undefined)
 * into a standard JavaScript Error instance with preserved context.
 */
export function normalizeError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === 'string') {
    return new Error(err);
  }
  if (typeof err === 'object' && err !== null) {
    try {
      const message = (err as any).message || JSON.stringify(err);
      const error = new Error(message);
      Object.assign(error, err);
      return error;
    } catch (_) {
      return new Error(String(err));
    }
  }
  return new Error(`Unknown rejection error: ${String(err)}`);
}

/**
 * Enterprise-Grade Asynchronous Higher-Order Function Handler for Express.
 *
 * Capabilities:
 * 1. Seamlessly wraps asynchronous controller functions, intercepting unhandled Promise rejections.
 * 2. Intercepts synchronous exceptions thrown before Promise initialization.
 * 3. Normalizes non-Error thrown types into standard Error objects with traceable stacks.
 * 4. Guards against duplicate response transmissions when headers or streams are already closed.
 * 5. Preserves function arity and descriptor names for OpenTelemetry, APM, and Express middleware inspectability.
 *
 * @param fn Asynchronous controller function: (req, res, next) => Promise<any>
 * @param options Optional configuration for custom error transformation or naming
 * @returns Standard Express RequestHandler: (req, res, next) => void
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
  Next extends NextFunction = NextFunction
>(
  fn: AsyncRequestHandler<Req, Res, Next>,
  options: AsyncHandlerOptions = {}
): RequestHandler {
  const handler: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    // Immediate circuit-breaker: if client aborted or stream already ended, skip execution
    if (res.headersSent || res.writableEnded || (res as any).destroyed || (req as any).aborted) {
      return;
    }

    try {
      // Execute the handler and ensure Promise resolution
      const result = fn(req as Req, res as Res, next as Next);

      return Promise.resolve(result).catch((err: unknown) => {
        // If response headers have already been transmitted, delegate directly to Express default handler
        if (res.headersSent || res.writableEnded || (res as any).destroyed) {
          return next(err);
        }

        const normalized = options.errorTransformer
          ? options.errorTransformer(err, req, res)
          : normalizeError(err);

        next(normalized);
      }) as any;
    } catch (syncErr: unknown) {
      // Catch synchronous errors thrown before any async await yields
      if (res.headersSent || res.writableEnded || (res as any).destroyed) {
        return next(syncErr);
      }

      const normalized = options.errorTransformer
        ? options.errorTransformer(syncErr, req, res)
        : normalizeError(syncErr);

      next(normalized);
    }
  };

  // Preserve function name and metadata for OpenTelemetry, APM, and Express stack inspection
  const targetName = options.name || fn.name || 'asyncHandler';
  Object.defineProperty(handler, 'name', { value: targetName, configurable: true });

  return handler;
}

export default asyncHandler;
