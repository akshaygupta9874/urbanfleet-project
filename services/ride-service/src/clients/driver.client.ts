import axios, { AxiosInstance, isAxiosError } from 'axios';

export interface DriverVehicle {
  id: string;
  type: string;
  category: string;
  brand: string;
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  registrationNumber: string;
  year: number;
}

export interface DriverUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface DriverProfile {
  id: string;
  userId: string;
  licenseNumber: string;
  verificationStatus: string;
  isAvailable: boolean;
  isOnline: boolean;
  rating: number;
  totalTrips: number;
  firstName: string;
  lastName: string;
  email: string;
  profilePhoto: string | null;
  profilePhotoUrl: string | null;
  vehicleNumber: string;
  vehicle: DriverVehicle;
  vehicles: DriverVehicle[];
  user: DriverUser;
}

export class DriverClient {
  private client: AxiosInstance;
  private cache = new Map<string, { data: DriverProfile; timestamp: number }>();

  constructor(
    baseUrl: string = process.env.DRIVER_SERVICE_URL || 'http://localhost:4002'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        Accept: 'application/json',
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || 'urbanfleet-internal-service-secret',
      },
    });
  }

  async getDriver(driverId: string): Promise<DriverProfile | null> {
    return this.getDriverById(driverId);
  }

  async getDriverById(driverId: string): Promise<DriverProfile | null> {
    if (!driverId) return null;
    const cached = this.cache.get(`driver:${driverId}`);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.data;
    }

    try {
      const res = await this.client.get<{ success: boolean; data: DriverProfile }>(
        `/v1/drivers/${driverId}`
      );
      if (res.data?.data) {
        this.cache.set(`driver:${driverId}`, { data: res.data.data, timestamp: Date.now() });
        return res.data.data;
      }
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
    }
    return null;
  }

  async getDriverByUserId(userId: string): Promise<DriverProfile | null> {
    if (!userId) return null;
    const cached = this.cache.get(`user:${userId}`);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.data;
    }

    try {
      const res = await this.client.get<{ success: boolean; data: DriverProfile }>(
        `/v1/drivers/by-user/${userId}`
      );
      if (res.data?.data) {
        this.cache.set(`user:${userId}`, { data: res.data.data, timestamp: Date.now() });
        return res.data.data;
      }
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
    return null;
  }
}

export const driverClient = new DriverClient();
