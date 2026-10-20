import axios, { AxiosInstance, AxiosRequestConfig, isAxiosError } from 'axios';

export interface ServiceClientOptions {
  baseURL: string;
  timeout?: number;
  internalServiceKey?: string;
  defaultHeaders?: Record<string, string>;
}

export function createServiceClient(options: ServiceClientOptions): AxiosInstance {
  const instance = axios.create({
    baseURL: options.baseURL,
    timeout: options.timeout ?? 5000,
    headers: {
      Accept: 'application/json',
      ...(options.internalServiceKey ? { 'x-internal-service-key': options.internalServiceKey } : {}),
      ...options.defaultHeaders,
    },
  });

  return instance;
}

export { axios, isAxiosError };
export type { AxiosInstance, AxiosRequestConfig };
