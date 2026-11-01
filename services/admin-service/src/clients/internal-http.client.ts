import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

export class InternalHttpClient {
  protected client: AxiosInstance;

  constructor(baseURL: string) {
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

  protected async request<T = unknown>(bearer: string | undefined, reqConfig: AxiosRequestConfig): Promise<{ data: T }> {
    return this.client.request<T>({
      ...reqConfig,
      headers: {
        ...reqConfig.headers,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });
  }
}
