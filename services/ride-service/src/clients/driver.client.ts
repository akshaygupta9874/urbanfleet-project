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
  private baseUrl: string;

  constructor(
    baseUrl: string = process.env.DRIVER_SERVICE_URL || 'http://localhost:4002'
  ) {
    this.baseUrl = baseUrl;
  }

  async getDriverById(driverId: string): Promise<DriverProfile | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/drivers/${driverId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Driver Service returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; data: DriverProfile };
      return body.data;
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        throw new Error('Driver Service timed out');
      }
      throw err;
    }
  }

  async getDriverByUserId(userId: string): Promise<DriverProfile | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/drivers/by-user/${userId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Driver Service returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; data: DriverProfile };
      return body.data;
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        throw new Error('Driver Service timed out');
      }
      throw err;
    }
  }
}

export const driverClient = new DriverClient();
