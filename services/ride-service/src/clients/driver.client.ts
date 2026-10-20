import axios, { AxiosInstance, isAxiosError } from 'axios';

export interface DriverProfile {
  id: string;
  userId: string;
  licenseNumber: string;
  verificationStatus: string;
  isAvailable: boolean;
  rating: number;
  totalTrips: number;
}

export class DriverClient {
  private client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.DRIVER_SERVICE_URL || 'http://localhost:4002'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: { Accept: 'application/json' },
    });
  }

  async getDriverById(driverId: string): Promise<DriverProfile | null> {
    try {
      const res = await this.client.get<{ success: boolean; data: DriverProfile }>(
        `/api/drivers/${driverId}`
      );
      return res.data?.data ?? null;
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        if (err.response?.status === 404) return null;
        if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
          throw new Error('Driver Service timed out');
        }
        if (err.response) {
          throw new Error(`Driver Service returned HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }

  async getDriverByUserId(userId: string): Promise<DriverProfile | null> {
    try {
      const res = await this.client.get<{ success: boolean; data: DriverProfile }>(
        `/api/drivers/by-user/${userId}`
      );
      return res.data?.data ?? null;
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        if (err.response?.status === 404) return null;
        if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
          throw new Error('Driver Service timed out');
        }
        if (err.response) {
          throw new Error(`Driver Service returned HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }
}

export const driverClient = new DriverClient();
