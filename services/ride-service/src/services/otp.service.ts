import crypto from 'crypto';
import type { RedisClientType } from 'redis';
import { rideRedisKey } from '../redis/client.js';

export class OtpService {
  private inMemoryStore = new Map<string, string>();
  private redis?: RedisClientType;

  constructor(redis?: RedisClientType) {
    this.redis = redis;
  }

  generateRideOtp(): string {
    return crypto.randomInt(1000, 10000).toString();
  }

  private getRedisKey(rideId: string): string {
    return rideRedisKey(`otp:${rideId}`);
  }

  /**
   * Stores the ride OTP in Redis with a 24-hour default TTL.
   */
  async storeRideOtp(rideId: string, otp: string, ttlSeconds = 86400): Promise<void> {
    if (this.redis && this.redis.isOpen) {
      await this.redis.set(this.getRedisKey(rideId), otp, { EX: ttlSeconds });
    } else {
      this.inMemoryStore.set(rideId, otp);
    }
  }

  /**
   * Retrieves the OTP for a ride from Redis.
   */
  async getRideOtp(rideId: string): Promise<string | null> {
    if (this.redis && this.redis.isOpen) {
      return await this.redis.get(this.getRedisKey(rideId));
    }
    return this.inMemoryStore.get(rideId) || null;
  }

  /**
   * Verifies the entered OTP against Redis storage using timing-safe comparison.
   * If direct OTP string is passed (e.g. 4-digit numeric code), supports fallback direct comparison.
   */
  async verifyRideOtp(rideIdOrStoredOtp: string, enteredOtp: string): Promise<boolean> {
    if (!rideIdOrStoredOtp || !enteredOtp) return false;

    // Check if rideId exists in store
    const storedOtp = await this.getRideOtp(rideIdOrStoredOtp);
    if (storedOtp) {
      return this.compareOtp(storedOtp, enteredOtp);
    }

    // Direct comparison fallback if first argument is already a 4-digit OTP code (e.g. standalone helper use)
    if (rideIdOrStoredOtp.length === 4 && /^\d{4}$/.test(rideIdOrStoredOtp)) {
      return this.compareOtp(rideIdOrStoredOtp, enteredOtp);
    }

    return false;
  }

  /**
   * Performs timing-safe equality comparison between two OTP strings.
   */
  compareOtp(storedOtp: string | null, enteredOtp: string): boolean {
    if (!storedOtp || !enteredOtp) return false;
    if (storedOtp.length !== enteredOtp.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(storedOtp), Buffer.from(enteredOtp));
    } catch {
      return storedOtp === enteredOtp;
    }
  }

  /**
   * Deletes and invalidates the ride OTP from Redis.
   */
  async invalidateRideOtp(rideId?: string): Promise<null> {
    if (rideId) {
      if (this.redis && this.redis.isOpen) {
        await this.redis.del(this.getRedisKey(rideId));
      } else {
        this.inMemoryStore.delete(rideId);
      }
    }
    return null;
  }
}

