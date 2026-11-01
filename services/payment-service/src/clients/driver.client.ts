import axios, { AxiosInstance, isAxiosError } from 'axios';
import { createLogger } from '@urbanfleet/common';

const logger = createLogger('payment-driver-client');

export interface DriverProfile {
  id: string;
  userId: string;
  verificationStatus: string;
  isAvailable: boolean;
  isOnline?: boolean;
}

export class DriverClient {
  private client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.DRIVER_SERVICE_URL || 'http://driver-service:4002'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  async getDriverByUserId(userId: string): Promise<DriverProfile | null> {
    try {
      const res = await this.client.get<{ success: boolean; data: DriverProfile }>(
        `/v1/drivers/by-user/${userId}`
      );
      return res?.data?.data ?? null;
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      logger.warn('Failed to query driver by userId from driver-service', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

export const driverClient = new DriverClient();
