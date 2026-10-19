export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: string;
  isEmailVerified: boolean;
}

export class AuthClient {
  constructor(
    private baseUrl: string = process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
  ) {}

  async getUserById(userId: string): Promise<AuthUser | null> {
    try {
      const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
      const res = await fetch(`${this.baseUrl}/api/auth/users/${userId}`, {
        headers: {
          Accept: 'application/json',
          'x-internal-service-key': internalKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Auth Service returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; data: AuthUser };
      return body.data;
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        throw new Error('Auth Service timed out');
      }
      throw err;
    }
  }
}

export const authClient = new AuthClient();
