import type { Request } from 'express';
import { BadRequestError } from '@urbanfleet/common';

export interface ClientMetadata {
  userAgent: string;
  ipAddress: string;
}

export interface ExtractClientMetadataOptions {
  required?: boolean;
}

/**
 * Single source of truth for client metadata (User-Agent and IP address).
 * Strictly observed from server request headers and network connection.
 * Untrusted caller-supplied body fields are never accepted.
 */
export function extractClientMetadata(
  req: Request,
  options: ExtractClientMetadataOptions = { required: true },
): ClientMetadata {
  const userAgent =
    (req.headers['user-agent'] as string) ||
    (!options.required ? 'UrbanFleet-Web/1.0' : '');

  const ipAddress =
    req.ip ||
    (req.headers['x-forwarded-for'] as string) ||
    req.socket?.remoteAddress ||
    (!options.required ? '127.0.0.1' : '');

  if (options.required && (!userAgent || !ipAddress)) {
    throw new BadRequestError('User-Agent header and client IP address are required');
  }

  return {
    userAgent,
    ipAddress,
  };
}
