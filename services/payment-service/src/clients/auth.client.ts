export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: string;
  roles?: string[];
  isEmailVerified: boolean;
}

export class AuthClient {
  constructor(
    private baseUrl: string = process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
  ) {}

  async getUserById(userId: string): Promise<AuthUser | null> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '',
    };

    try {
      let res = await fetch(`${this.baseUrl}/api/auth/users/${userId}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) {
        res = await fetch(`${this.baseUrl}/v1/auth/users/${userId}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
      }

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
      return null;
    }
  }
}

export const authClient = new AuthClient();
