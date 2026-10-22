import crypto from 'crypto';
import type { RedisClientType } from 'redis';
import { AppError } from '@urbanfleet/common';
import { rideRedisKey } from '../redis/client.js';

const RIDE_OTP_TTL_SECONDS = 60 * 60;

export class OtpService {
  private redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  generateRideOtp(): string {
    return crypto.randomInt(1000, 10000).toString();
  }

  private getRedisKey(rideId: string): string {
    return rideRedisKey(`otp:${rideId}`);
  }

  async storeRideOtp(rideId: string, otp: string): Promise<void> {
    if (!rideId || !/^\d{4}$/.test(otp)) {
      throw new AppError('Invalid ride verification code', 400, 'INVALID_OTP');
    }
    if (!this.redis.isOpen) {
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
    try {
      await this.redis.set(this.getRedisKey(rideId), otp, { EX: RIDE_OTP_TTL_SECONDS });
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
  }

  async getRideOtp(rideId: string): Promise<string | null> {
    if (!rideId) return null;
    if (!this.redis.isOpen) {
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
    try {
      return await this.redis.get(this.getRedisKey(rideId));
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
  }

  async verifyRideOtp(rideId: string, enteredOtp: string): Promise<boolean> {
    if (!rideId || !/^\d{4}$/.test(enteredOtp)) return false;
    const storedOtp = await this.getRideOtp(rideId);
    return this.compareOtp(storedOtp, enteredOtp);
  }

  private compareOtp(storedOtp: string | null, enteredOtp: string): boolean {
    if (!storedOtp || !/^\d{4}$/.test(storedOtp) || !/^\d{4}$/.test(enteredOtp)) return false;
    if (storedOtp.length !== enteredOtp.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(storedOtp), Buffer.from(enteredOtp));
    } catch {
      return false;
    }
  }

  async invalidateRideOtp(rideId: string): Promise<void> {
    if (!rideId) return;
    if (!this.redis.isOpen) {
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
    try {
      await this.redis.del(this.getRedisKey(rideId));
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      throw new AppError('Ride verification is temporarily unavailable', 503, 'REDIS_UNAVAILABLE');
    }
  }
}
