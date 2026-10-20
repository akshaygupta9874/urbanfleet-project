import type { Application } from 'express';

/**
 * Configures standard Express JSON serialization to natively handle BigInt values
 * without mutating global JavaScript prototypes.
 */
export function configureBigIntSerialization(app: Application): void {
  app.set('json replacer', (_key: string, value: unknown) => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  });
}

/**
 * Deeply transforms any BigInt values in an object or array to regular numbers.
 * Safe for use before JSON.stringify or event dispatch.
 */
export function serializeBigInt<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === 'bigint') {
    return Number(data) as unknown as T;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(serializeBigInt) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    result[key] = typeof value === 'bigint' ? Number(value) : serializeBigInt(value);
  }
  return result as T;
}
