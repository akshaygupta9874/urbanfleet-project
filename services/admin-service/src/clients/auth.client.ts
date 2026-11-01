import { InternalHttpClient } from './internal-http.client.js';
import { config } from '../config/config.js';

export class AuthClient extends InternalHttpClient {
  constructor(baseURL: string = config.services.auth) {
    super(baseURL);
  }

  async getUsers(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/auth/admin/users',
      params,
    });
  }

  async getSessions(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/auth/admin/sessions',
      params,
    });
  }

  async revokeSession(bearer: string | undefined, sessionId: string) {
    return this.request(bearer, {
      method: 'DELETE',
      url: `/v1/auth/admin/sessions/${sessionId}`,
    });
  }

  async setSuspension(bearer: string | undefined, userId: string, suspended: boolean, reason: string) {
    return this.request(bearer, {
      method: 'PATCH',
      url: `/v1/auth/admin/users/${userId}/suspension`,
      params: { suspended },
      data: { reason },
    });
  }

  async getAuditLogs(bearer: string | undefined, params: Record<string, unknown> = {}) {
    return this.request(bearer, {
      method: 'GET',
      url: '/v1/auth/admin/audit',
      params,
    });
  }

  async recordAudit(bearer: string | undefined, audit: { action: string; resource: string; resourceId?: string; reason?: string }) {
    return this.request(bearer, {
      method: 'POST',
      url: '/v1/auth/admin/audit',
      data: audit,
    }).catch(() => undefined);
  }

  async checkHealth() {
    return this.client.get('/health', { timeout: 3000 });
  }
}

export const authClient = new AuthClient();
