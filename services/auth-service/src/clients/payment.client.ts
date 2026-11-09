import axios, { AxiosInstance } from 'axios';

export class PaymentClient {
  private client: AxiosInstance;

  constructor(baseURL: string = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:4005') {
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

  async getPayments(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.client.get('/v1/payments/admin/list', {
      params,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async getMetrics(bearer: string | undefined, period: string = '7d') {
    return this.client.get('/v1/payments/admin/metrics', {
      params: { period },
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const paymentClient = new PaymentClient();
