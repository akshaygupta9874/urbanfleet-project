import { InternalHttpClient } from './internal-http.client.js';
import { config } from '../config/config.js';

export class PaymentClient extends InternalHttpClient {
  constructor(baseURL: string = config.services.payment) {
    super(baseURL);
  }

  async getPayments(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/payments/admin/list',
      params,
    });
  }

  async refundPayment(bearer: string | undefined, paymentId: string, reason: string, amountPaise?: number, idempotencyKey?: string) {
    return this.request(bearer, {
      method: 'POST',
      url: `/v1/payments/${paymentId}/refund`,
      data: { reason, amountPaise },
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    });
  }

  async getMetrics(bearer: string | undefined, period: string = '7d') {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/payments/admin/metrics',
      params: { period },
    });
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const paymentClient = new PaymentClient();
