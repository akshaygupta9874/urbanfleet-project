import axios, { AxiosInstance } from 'axios';

export class DriverClient {
  private client: AxiosInstance;

  constructor(baseURL: string = process.env.DRIVER_SERVICE_URL || 'http://driver-service:4002') {
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

  async getDrivers(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.client.get('/v1/drivers/admin/list', {
      params,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async updateVerification(bearer: string | undefined, driverId: string, status: string, reason: string) {
    return this.client.patch(
      `/v1/drivers/admin/${driverId}/verification`,
      { status, reason },
      {
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      }
    );
  }

  async getMetrics(bearer: string | undefined) {
    return this.client.get('/v1/drivers/admin/metrics', {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const driverClient = new DriverClient();
