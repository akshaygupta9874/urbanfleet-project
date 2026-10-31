import axios, { AxiosInstance, isAxiosError } from 'axios';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isEmailVerified: boolean;
}

export class AuthClient {
  private client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
  ) {
    const internalKey =
      process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        Accept: 'application/json',
        'x-internal-service-key': internalKey,
      },
    });
  }

  async getUserById(userId: string, token?: string): Promise<AuthUser | null> {
    try {
      const res = token
        ? await this.client.get<{ success: boolean; data: AuthUser }>(`/api/auth/users/${userId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        : await this.client.get<{ success: boolean; data: AuthUser }>(`/api/auth/users/${userId}`);
      return res.data?.data ?? null;
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        if (err.response?.status === 404) return null;
        if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
          throw new Error('Auth Service timed out');
        }
        if (err.response) {
          throw new Error(`Auth Service returned HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }

  async grantDriverRole(userId: string): Promise<void> {
    try {
      await this.client.post(`/api/auth/internal/users/${userId}/driver-role`);
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          throw new Error('Auth Service timed out while granting driver role');
        }
        if (err.response) {
          throw new Error(`Auth Service rejected driver role grant with HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }
}

export const authClient = new AuthClient();
