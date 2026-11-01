import { InternalHttpClient } from './internal-http.client.js';
import { config } from '../config/config.js';

export class RideClient extends InternalHttpClient {
  constructor(baseURL: string = config.services.ride) {
    super(baseURL);
  }

  async getRides(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/rides/admin/list',
      params,
    });
  }

  async getMetrics(bearer: string | undefined, period: string = '7d') {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/rides/admin/metrics',
      params: { period },
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const rideClient = new RideClient();
