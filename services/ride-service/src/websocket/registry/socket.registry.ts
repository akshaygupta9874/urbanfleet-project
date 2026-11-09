import { WebSocket } from 'ws';
import type { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { AuthenticatedSocket, AuthenticatedSocketUser } from '../types/index.js';

const logger = createLogger('socket-registry');

function resolveUserRoles(user: AuthenticatedSocketUser): string[] {
  const raw =
    user.roles ??
    (Array.isArray(user.role) ? user.role : user.role ? [user.role] : undefined);
  return Array.isArray(raw) && raw.length > 0 ? raw : ['RIDER'];
}

export class SocketRegistry {
  private readonly driverSockets = new Map<string, Set<AuthenticatedSocket>>();
  private readonly riderSockets = new Map<string, Set<AuthenticatedSocket>>();
  private readonly socketUsers = new Map<AuthenticatedSocket, AuthenticatedSocketUser>();

  // Tracks active Redis subscriptions and serializes subscribe/unsubscribe per channel
  private readonly subscribedChannels = new Set<string>();
  private readonly channelQueues = new Map<string, Promise<void>>();

  private redisSub?: RedisClientType;

  setRedisSubscriber(redisSub?: RedisClientType): void {
    this.redisSub = redisSub;
    this.subscribedChannels.clear();
    this.channelQueues.clear();
  }

  async register(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    if (!user?.userId) return;

    const roles = resolveUserRoles(user);
    user.roles = roles;
    this.socketUsers.set(socket, user);

    const hasRiderRole = roles.includes('RIDER') || !user.driverId;
    const hasDriverRole = roles.includes('DRIVER') && Boolean(user.driverId);

    const tasks: Promise<void>[] = [];

    if (hasRiderRole) {
      let rSockets = this.riderSockets.get(user.userId);
      if (!rSockets) {
        rSockets = new Set();
        this.riderSockets.set(user.userId, rSockets);
      }
      rSockets.add(socket);

      const channel = `ws:rider:${user.userId}`;
      tasks.push(
        this.syncChannel(
          channel,
          () => (this.riderSockets.get(user.userId)?.size ?? 0) > 0,
          (message) => this.deliverToRider(user.userId, message)
        )
      );
    }

    if (hasDriverRole && user.driverId) {
      const driverId = user.driverId;
      let dSockets = this.driverSockets.get(driverId);
      if (!dSockets) {
        dSockets = new Set();
        this.driverSockets.set(driverId, dSockets);
      }
      dSockets.add(socket);

      const channel = `ws:driver:${driverId}`;
      tasks.push(
        this.syncChannel(
          channel,
          () => (this.driverSockets.get(driverId)?.size ?? 0) > 0,
          (message) => this.deliverToDriver(driverId, message)
        )
      );
    }

    await Promise.all(tasks);
  }

  async unregister(socket: AuthenticatedSocket): Promise<void> {
    const user = this.socketUsers.get(socket);
    if (!user) return;

    this.socketUsers.delete(socket);

    const roles = resolveUserRoles(user);
    const hasRiderRole = roles.includes('RIDER') || !user.driverId;
    const hasDriverRole = roles.includes('DRIVER') && Boolean(user.driverId);

    const tasks: Promise<void>[] = [];

    if (hasRiderRole) {
      const rSockets = this.riderSockets.get(user.userId);
      if (rSockets) {
        rSockets.delete(socket);
        if (rSockets.size === 0) {
          this.riderSockets.delete(user.userId);
        }
        const channel = `ws:rider:${user.userId}`;
        tasks.push(
          this.syncChannel(
            channel,
            () => (this.riderSockets.get(user.userId)?.size ?? 0) > 0,
            (message) => this.deliverToRider(user.userId, message)
          )
        );
      }
    }

    if (hasDriverRole && user.driverId) {
      const driverId = user.driverId;
      const dSockets = this.driverSockets.get(driverId);
      if (dSockets) {
        dSockets.delete(socket);
        if (dSockets.size === 0) {
          this.driverSockets.delete(driverId);
        }
        const channel = `ws:driver:${driverId}`;
        tasks.push(
          this.syncChannel(
            channel,
            () => (this.driverSockets.get(driverId)?.size ?? 0) > 0,
            (message) => this.deliverToDriver(driverId, message)
          )
        );
      }
    }

    await Promise.all(tasks);
  }

  /**
   * Serializes Redis subscribe/unsubscribe operations per channel so rapid
   * connect/disconnect bursts never race or leak subscriptions.
   */
  private syncChannel(
    channel: string,
    shouldBeSubscribed: () => boolean,
    listener: (message: string) => void
  ): Promise<void> {
    const previous = this.channelQueues.get(channel) ?? Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(async () => {
        if (!this.redisSub?.isOpen) return;

        const wantSub = shouldBeSubscribed();
        const isSub = this.subscribedChannels.has(channel);

        if (wantSub && !isSub) {
          try {
            await this.redisSub.subscribe(channel, listener);
            this.subscribedChannels.add(channel);
            logger.debug(`Subscribed to Redis channel: ${channel}`);
          } catch (err) {
            logger.error(`Failed to subscribe to ${channel}`, { error: err });
          }
        } else if (!wantSub && isSub) {
          try {
            await this.redisSub.unsubscribe(channel);
            this.subscribedChannels.delete(channel);
            logger.debug(`Unsubscribed from Redis channel: ${channel}`);
          } catch (err) {
            logger.error(`Failed to unsubscribe from ${channel}`, { error: err });
          }
        }
      })
      .finally(() => {
        if (this.channelQueues.get(channel) === next) {
          this.channelQueues.delete(channel);
        }
      });

    this.channelQueues.set(channel, next);
    return next;
  }

  deliverToDriver(driverId: string, message: string): void {
    this.broadcastToSet(this.driverSockets.get(driverId), message);
  }

  deliverToRider(riderId: string, message: string): void {
    this.broadcastToSet(this.riderSockets.get(riderId), message);
  }

  private broadcastToSet(sockets: Set<AuthenticatedSocket> | undefined, message: string): void {
    if (!sockets) return;

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
        } catch (err) {
          logger.warn('Failed to send message to local WebSocket', { error: err });
        }
      }
    }
  }

  getDriverSockets(driverId: string): Set<AuthenticatedSocket> | undefined {
    return this.driverSockets.get(driverId);
  }

  getRiderSockets(riderId: string): Set<AuthenticatedSocket> | undefined {
    return this.riderSockets.get(riderId);
  }

  getUser(socket: AuthenticatedSocket): AuthenticatedSocketUser | undefined {
    return this.socketUsers.get(socket);
  }

  isDriverOnline(driverId: string): boolean {
    return (this.driverSockets.get(driverId)?.size ?? 0) > 0;
  }

  isRiderOnline(riderId: string): boolean {
    return (this.riderSockets.get(riderId)?.size ?? 0) > 0;
  }

  getConnectedDriversCount(): number {
    return this.driverSockets.size;
  }

  getConnectedRidersCount(): number {
    return this.riderSockets.size;
  }

  getTotalConnectedSockets(): number {
    return this.socketUsers.size;
  }

  broadcast(message: string): void {
    for (const socket of this.socketUsers.keys()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }

  disconnectDriver(driverId: string): void {
    const sockets = this.driverSockets.get(driverId);
    if (!sockets) return;

    for (const socket of sockets) {
      socket.close();
    }
  }

  disconnectRider(riderId: string): void {
    const sockets = this.riderSockets.get(riderId);
    if (!sockets) return;

    for (const socket of sockets) {
      socket.close();
    }
  }
}

export const socketRegistry = new SocketRegistry();