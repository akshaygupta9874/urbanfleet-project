import jwt, { type JwtPayload } from 'jsonwebtoken';

export interface AccessPayload extends JwtPayload {
  userId?: string;
  roles?: string[];
  tokenType?: string;
}

export function verifyAdminToken(token: string, publicKeyBase64: string): AccessPayload {
  const payload = jwt.verify(token, Buffer.from(publicKeyBase64, 'base64').toString('utf8'), {
    algorithms: ['RS256'],
    issuer: 'urbanfleet-auth',
    audience: 'urbanfleet-api',
  }) as AccessPayload;
  if (payload.tokenType && payload.tokenType !== 'ACCESS') throw new Error('Invalid token type');
  if (!payload.userId || !payload.roles?.includes('ADMIN')) throw new Error('Administrator role required');
  return payload;
}
