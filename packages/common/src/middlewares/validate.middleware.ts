import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

export interface RequestValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

function isZodSchema(value: unknown): value is ZodSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    'safeParse' in value &&
    typeof (value as { safeParse: unknown }).safeParse === 'function'
  );
}

export function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'general';
    (formatted[path] ||= []).push(issue.message);
  }
  return formatted;
}

/**
 * Generic Express middleware for Zod validation.
 * Accepts either a field-mapped schema object ({ body, query, params, headers })
 * or a single unified Zod schema.
 */
export function validateRequest(schemas: RequestValidationSchemas | ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Record<string, string[]> = {};
    const locations = ['body', 'query', 'params', 'headers'] as const;

    if (isZodSchema(schemas)) {
      const result = schemas.safeParse({
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
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

      Object.assign(req, result.data);
      return next();
    }

    const map = schemas as RequestValidationSchemas;
    for (const loc of locations) {
      if (map[loc]) {
        const result = map[loc]!.safeParse(req[loc]);
        if (!result.success) {
          Object.assign(errors, formatZodError(result.error));
        } else {
          req[loc] = result.data;
        }
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
  };
}

export const validate = validateRequest;
