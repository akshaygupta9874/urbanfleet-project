import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { verifyAdminToken } from '../src/auth.js';

describe('admin token authorization', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const privateKey = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const encoded = Buffer.from(publicKey).toString('base64');

  it('accepts an access token carrying the ADMIN role', () => {
    const token = jwt.sign(
      { userId: '00000000-0000-0000-0000-000000000001', roles: ['ADMIN'], tokenType: 'ACCESS' },
      privateKey,
      { algorithm: 'RS256', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' },
    );
    expect(verifyAdminToken(token, encoded).roles).toContain('ADMIN');
  });

  it('rejects a valid token without ADMIN', () => {
    const token = jwt.sign(
      { userId: '00000000-0000-0000-0000-000000000001', roles: ['RIDER'], tokenType: 'ACCESS' },
      privateKey,
      { algorithm: 'RS256', issuer: 'urbanfleet-auth', audience: 'urbanfleet-api' },
    );
    expect(() => verifyAdminToken(token, encoded)).toThrow('Administrator role required');
  });
});
