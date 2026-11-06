import { InternalHttpClient } from './internal-http.client.js';
import { config } from '../config/config.js';

export class DriverClient extends InternalHttpClient {
  constructor(baseURL: string = config.services.driver) {
    super(baseURL);
  }

  async getDrivers(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/drivers/admin/list',
      params,
    });
  }

  async updateVerification(bearer: string | undefined, driverId: string, status: string, reason: string) {
    return this.request(bearer, {
      method: 'PATCH',
      url: `/v1/drivers/admin/${driverId}/verification`,
      data: { status, reason },
    });
  }

  async getMetrics(bearer: string | undefined) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/drivers/admin/metrics',
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const driverClient = new DriverClient();
