import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError
} from '../src/errors/app-error.js';

describe('Application Error Hierarchy', () => {
  it('should initialize AppError with status code and code', () => {
    const err = new AppError('Server error', 500, 'INTERNAL');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL');
    expect(err.isOperational).toBe(true);
  });

  it('should initialize specialized errors with correct HTTP codes', () => {
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new ConflictError().statusCode).toBe(409);
    expect(new ValidationError().statusCode).toBe(400);
  });
});
