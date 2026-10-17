import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import type { GeoService } from './geo.service.js';

const logger = createLogger('driver-presence-service');
const PRESENCE_TTL_SECONDS = 300; // 5 minutes TTL
const HEARTBEAT_TTL_SECONDS = 60; // 60 seconds TTL

export interface DriverPresence {
  online: boolean;
  available: boolean;
  lastSeen: number;
}

export class DriverPresenceService {
  constructor(
    private redis: RedisClientType,
    private geoService?: GeoService
  ) {}

  private presenceKey(driverId: string): string {
    return `ride:driver:presence:${driverId}`;
  }

  private heartbeatKey(driverId: string): string {
    return `driver:heartbeat:${driverId}`;
  }

  async getPresence(driverId: string): Promise<DriverPresence | null> {
    try {
      const data = await this.redis.get(this.presenceKey(driverId));
      if (!data) return null;
      return JSON.parse(data) as DriverPresence;
    } catch (err) {
      logger.error(`Error reading presence for driver ${driverId}:`, err);
      return null;
    }
  }

  async setDriverOnline(driverId: string): Promise<DriverPresence> {
    const presence: DriverPresence = {
      online: true,
      available: false,
      lastSeen: Date.now(),
    };

    await this.redis.set(this.presenceKey(driverId), JSON.stringify(presence), {
      EX: PRESENCE_TTL_SECONDS,
    });
    await this.redis.set(this.heartbeatKey(driverId), '1', {
      EX: HEARTBEAT_TTL_SECONDS,
    });

    logger.info(`Driver ${driverId} is now ONLINE (awaiting availability).`);
    return presence;
  }

  async setDriverAvailable(driverId: string, available = true): Promise<DriverPresence> {
    const presence: DriverPresence = {
      online: true,
      available,
      lastSeen: Date.now(),
    };

    await this.redis.set(this.presenceKey(driverId), JSON.stringify(presence), {
      EX: PRESENCE_TTL_SECONDS,
    });
    await this.redis.set(this.heartbeatKey(driverId), '1', {
      EX: HEARTBEAT_TTL_SECONDS,
    });

    if (!available && this.geoService) {
      await this.geoService.removeDriverLocation(driverId);
    }

    logger.info(`Driver ${driverId} availability set to: ${available}.`);
    return presence;
  }

  async setDriverBusy(driverId: string): Promise<DriverPresence> {
    const presence: DriverPresence = {
      online: true,
      available: false,
      lastSeen: Date.now(),
    };

    await this.redis.set(this.presenceKey(driverId), JSON.stringify(presence), {
      EX: PRESENCE_TTL_SECONDS,
    });
    await this.redis.set(this.heartbeatKey(driverId), '1', {
      EX: HEARTBEAT_TTL_SECONDS,
    });

    if (this.geoService) {
      await this.geoService.removeDriverLocation(driverId);
    }

    logger.info(`Driver ${driverId} marked as BUSY (on active ride).`);
    return presence;
  }

  async setDriverOffline(driverId: string): Promise<void> {
    try {
      if (this.geoService) {
        await this.geoService.removeDriverLocation(driverId);
      }
      await this.redis.del(this.heartbeatKey(driverId));
      await this.redis.del(this.presenceKey(driverId));
      logger.info(`Driver ${driverId} is now OFFLINE.`);
    } catch (err) {
      logger.error(`Error taking driver ${driverId} offline:`, err);
    }
  }

  async updateHeartbeat(driverId: string): Promise<DriverPresence | null> {
    const presence = await this.getPresence(driverId);
    if (!presence) {
      return null;
    }

    presence.lastSeen = Date.now();

    await this.redis.set(this.presenceKey(driverId), JSON.stringify(presence), {
      EX: PRESENCE_TTL_SECONDS,
    });
    await this.redis.set(this.heartbeatKey(driverId), '1', {
      EX: HEARTBEAT_TTL_SECONDS,
    });

    return presence;
  }

  async isDriverOnline(driverId: string): Promise<boolean> {
    const presence = await this.getPresence(driverId);
    return Boolean(presence && presence.online);
  }

  async isDriverAvailable(driverId: string): Promise<boolean> {
    const presence = await this.getPresence(driverId);
    return Boolean(presence && presence.online && presence.available);
  }
}
