import axios, { AxiosInstance } from 'axios';

export class RideClient {
  private client: AxiosInstance;

  constructor(baseURL: string = process.env.RIDE_SERVICE_URL || 'http://ride-service:4004') {
    const internalKey = process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret';
    this.client = axios.create({
      baseURL,
      timeout: 8000,
      headers: {
        Accept: 'application/json',
        'x-internal-service-key': internalKey,
      },
    });
  }

  async getRides(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.client.get('/v1/rides/admin/list', {
      params,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async getMetrics(bearer: string | undefined, period: string = '7d') {
    return this.client.get('/v1/rides/admin/metrics', {
      params: { period },
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const rideClient = new RideClient();
