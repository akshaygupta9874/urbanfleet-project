import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError, z } from 'zod';

export interface RequestValidationSchemas {
  body?: ZodType<any>;
  query?: ZodType<any>;
  params?: ZodType<any>;
  headers?: ZodType<any>;
}

export function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'general';
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }
  return formatted;
}

/**
 * Universal Express middleware that validates req.body, req.query, and/or req.params using Zod.
 * Strips or coerces inputs and attaches parsed values to the request.
 * Responds with HTTP 422 and structured field-level errors on validation failure.
 */
export function validateRequest(schemas: RequestValidationSchemas | ZodType<any>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Check if a single composite Zod schema { body, query, params } was passed
      if ('parse' in schemas && typeof (schemas as any).parse === 'function') {
        const schema = schemas as ZodType<any>;
        const result = schema.safeParse({
          body: req.body,
          query: req.query,
          params: req.params,
        });

        if (!result.success) {
          res.status(422).json({
            success: false,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            errors: formatZodError(result.error),
          });
          return;
        }

        const data = result.data as any;
        if (data.body !== undefined) req.body = data.body;
        if (data.query !== undefined) req.query = data.query;
        if (data.params !== undefined) req.params = data.params;
        return next();
      }

      const explicitSchemas = schemas as RequestValidationSchemas;
      const errors: Record<string, string[]> = {};

      if (explicitSchemas.body) {
        const result = explicitSchemas.body.safeParse(req.body);
        if (!result.success) {
          Object.assign(errors, formatZodError(result.error));
        } else {
          req.body = result.data;
        }
      }

      if (explicitSchemas.query) {
        const result = explicitSchemas.query.safeParse(req.query);
        if (!result.success) {
          Object.assign(errors, formatZodError(result.error));
        } else {
          req.query = result.data;
        }
      }

      if (explicitSchemas.params) {
        const result = explicitSchemas.params.safeParse(req.params);
        if (!result.success) {
          Object.assign(errors, formatZodError(result.error));
        } else {
          req.params = result.data;
        }
      }

      if (Object.keys(errors).length > 0) {
        res.status(422).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          errors,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const validate = validateRequest;
