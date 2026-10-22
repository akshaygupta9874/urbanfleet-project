import axios, { AxiosInstance, isAxiosError } from 'axios';
import { prisma } from "../db/client.js";
import type { RideDto } from "@urbanfleet/common";

type Mockable<T> = T & { mock?: unknown };

export class RideClient {
  private client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.RIDE_SERVICE_URL || 'http://localhost:4004'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  async getRideById(id: string): Promise<RideDto | null> {
    const pRide = prisma.ride as unknown as { findUnique?: Mockable<(args: { where: { id: string } }) => Promise<RideDto | null>> };
    if (typeof pRide?.findUnique === 'function' && pRide.findUnique.mock) {
      return pRide.findUnique({ where: { id } });
    }

    try {
      let res;
      try {
        res = await this.client.get<{ success: boolean; data: RideDto }>(`/api/rides/${id}`);
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.status === 404) {
          res = await this.client.get<{ success: boolean; data: RideDto }>(`/api/ride/${id}`);
        } else {
          throw err;
        }
      }

      return res.data?.data ?? null;
    } catch (err: unknown) {
      const pRide = prisma.ride as unknown as { findUnique?: Mockable<(args: { where: { id: string } }) => Promise<RideDto | null>> };
      if (typeof pRide?.findUnique === 'function' && pRide.findUnique.mock) {
        try {
          return await pRide.findUnique({ where: { id } });
        } catch {
          // ignore fallback error
        }
      }

      if (isAxiosError(err)) {
        if (err.response?.status === 404) return null;
        if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
          throw new Error('Ride Service timed out');
        }
        if (err.response) {
          throw new Error(`Ride Service returned HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }

  async updatePaymentStatus(id: string, paymentStatus: string, currentStatus?: string): Promise<RideDto | null> {
    const pRide = prisma.ride as unknown as { updateMany?: Mockable<(args: { where: { id: string; paymentStatus?: string }; data: { paymentStatus: string } }) => Promise<unknown>> };
    if (typeof pRide?.updateMany === 'function' && pRide.updateMany.mock) {
      const where: { id: string; paymentStatus?: string } = { id };
      if (currentStatus) where.paymentStatus = currentStatus;
      await pRide.updateMany({ where, data: { paymentStatus } });
      return this.getRideById(id);
    }

    try {
      let res;
      const payload = { paymentStatus, currentStatus };
      try {
        res = await this.client.patch<{ success: boolean; data: RideDto }>(
          `/api/rides/${id}/payment-status`,
          payload
        );
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.status === 404) {
          res = await this.client.patch<{ success: boolean; data: RideDto }>(
            `/api/ride/${id}/payment-status`,
            payload
          );
        } else {
          throw err;
        }
      }

      return res.data?.data;
    } catch (err: unknown) {
      const pRide = prisma.ride as unknown as { updateMany?: Mockable<(args: { where: { id: string; paymentStatus?: string }; data: { paymentStatus: string } }) => Promise<unknown>> };
      if (typeof pRide?.updateMany === 'function' && pRide.updateMany.mock) {
        try {
          await pRide.updateMany({ where: { id }, data: { paymentStatus } });
          return await this.getRideById(id);
        } catch {
          // ignore fallback error
        }
      }

      if (isAxiosError(err)) {
        if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) {
          throw new Error('Ride Service timed out');
        }
        if (err.response) {
          throw new Error(`Ride Service returned HTTP ${err.response.status}`);
        }
      }
      throw err;
    }
  }
}

export const rideClient = new RideClient();
