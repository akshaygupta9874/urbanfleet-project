import axios, { AxiosInstance, isAxiosError } from 'axios';

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
  private client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.AUTH_SERVICE_URL || 'http://localhost:4001'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        Accept: 'application/json',
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '',
      },
    });
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    try {
      let res;
      try {
        res = await this.client.get<{ success: boolean; data: AuthUser }>(
          `/api/auth/users/${userId}`
        );
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.status === 404) {
          res = await this.client.get<{ success: boolean; data: AuthUser }>(
            `/v1/auth/users/${userId}`
          );
        } else {
          throw err;
        }
      }

      return res?.data?.data ?? null;
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
      return null;
    }
  }
}

export const authClient = new AuthClient();
