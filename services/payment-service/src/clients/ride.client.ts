import axios, { AxiosInstance, isAxiosError } from 'axios';
import type { RideDto } from '@urbanfleet/common';

interface RideResponse {
  success: boolean;
  data: RideDto;
}

export class RideClient {
  private readonly client: AxiosInstance;

  constructor(
    baseUrl: string = process.env.RIDE_SERVICE_URL || 'http://localhost:4004',
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
    try {
      const response = await this.client.get<RideResponse>(`/v1/rides/${id}`);
      return response.data?.data ?? null;
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 404) return null;
      throw this.toServiceError(err);
    }
  }

  async updatePaymentStatus(
    id: string,
    paymentStatus: string,
    currentStatus: string | null,
  ): Promise<RideDto | null> {
    try {
      const payload = { paymentStatus, currentStatus };
      const response = await this.client.patch<RideResponse>(
        `/v1/rides/${id}/payment-status`,
        payload
      );
      return response.data?.data ?? null;
    } catch (err: unknown) {
      throw this.toServiceError(err);
    }
  }

  private toServiceError(error: unknown): Error {
    if (!isAxiosError(error)) {
      return error instanceof Error ? error : new Error(String(error));
    }

    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.message.toLowerCase().includes('timeout')
    ) {
      return new Error('Ride Service timed out');
    }

    if (error.response) {
      return new Error(`Ride Service returned HTTP ${error.response.status}`);
    }

    return new Error(error.message);
  }
}

export const rideClient = new RideClient();
