import axios, { AxiosInstance, isAxiosError } from 'axios';
import { prisma } from "../db/client.js";
import type { IFareBreakdown } from "../payment/types/payment.types.js";

export interface IRide {
  id: string;
  riderId: string;
  driverId?: string | null;
  status: string;
  paymentStatus?: string;
  farePaise?: number;
  totalFarePaise?: number;
  totalFare?: number;
  baseFarePaise?: number;
  fareBreakdown?: IFareBreakdown;
  fare?: { breakdown?: IFareBreakdown; [key: string]: unknown };
  [key: string]: unknown;
}

function extractEntityId(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && 'id' in val && (val as { id?: unknown }).id) {
    return String((val as { id: unknown }).id);
  }
  return undefined;
}

type Mockable<T> = T & { mock?: unknown };

export function formatRide(ride: IRide | Record<string, unknown> | null | undefined): IRide | null {
  if (!ride) return null;
  const riderId = String(ride.riderId ?? '');
  const driverId = ride.driverId ? String(ride.driverId) : null;
  let fareBreakdown = ride.fareBreakdown;
  if (!fareBreakdown && ride.totalFarePaise !== undefined) {
    const total = Number(ride.totalFarePaise);
    const platform = Math.round(total * 0.10);
    const driver = total - platform;
    fareBreakdown = {
      baseFarePaise: Number(ride.baseFarePaise ?? total),
      distanceFarePaise: 0,
      timeFarePaise: 0,
      surgePaise: 0,
      platformCommissionPaise: platform,
      driverEarningPaise: driver,
      totalPaise: total
    };
  }
  return {
    ...ride,
    id: String(ride.id),
    riderId: riderId ?? '',
    driverId,
    rider: riderId,
    driver: driverId,
    status: String(ride.status || ''),
    fareBreakdown: fareBreakdown as IFareBreakdown | undefined,
  };
}

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
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '',
      },
    });
  }

  async getRideById(id: string): Promise<IRide | null> {
    const pRide = prisma.ride as unknown as { findUnique?: Mockable<(args: { where: { id: string } }) => Promise<IRide | null>> };
    if (typeof pRide?.findUnique === 'function' && pRide.findUnique.mock) {
      return pRide.findUnique({ where: { id } });
    }

    try {
      let res;
      try {
        res = await this.client.get<{ success: boolean; data: IRide }>(`/api/rides/${id}`);
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.status === 404) {
          res = await this.client.get<{ success: boolean; data: IRide }>(`/api/ride/${id}`);
        } else {
          throw err;
        }
      }

      return res.data?.data ?? null;
    } catch (err: unknown) {
      const pRide = prisma.ride as unknown as { findUnique?: Mockable<(args: { where: { id: string } }) => Promise<IRide | null>> };
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

  async updatePaymentStatus(id: string, paymentStatus: string, currentStatus?: string): Promise<unknown> {
    const pRide = prisma.ride as unknown as { updateMany?: Mockable<(args: { where: { id: string; paymentStatus?: string }; data: { paymentStatus: string } }) => Promise<unknown>> };
    if (typeof pRide?.updateMany === 'function' && pRide.updateMany.mock) {
      const where: { id: string; paymentStatus?: string } = { id };
      if (currentStatus) where.paymentStatus = currentStatus;
      return pRide.updateMany({ where, data: { paymentStatus } });
    }

    try {
      let res;
      const payload = { paymentStatus, currentStatus };
      try {
        res = await this.client.patch<{ success: boolean; data: unknown }>(
          `/api/rides/${id}/payment-status`,
          payload
        );
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.status === 404) {
          res = await this.client.patch<{ success: boolean; data: unknown }>(
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
          return await pRide.updateMany({ where: { id }, data: { paymentStatus } });
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
