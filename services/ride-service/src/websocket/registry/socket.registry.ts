import { AuthenticatedSocket, AuthenticatedSocketUser } from '../types.js';

export class SocketRegistry {
  private readonly driverSockets = new Map<string, Set<AuthenticatedSocket>>();
  private readonly riderSockets = new Map<string, Set<AuthenticatedSocket>>();
  private readonly socketUsers = new Map<AuthenticatedSocket, AuthenticatedSocketUser>();

  register(socket: AuthenticatedSocket): void {
    const { userId, driverId, role } = socket.user;

    this.socketUsers.set(socket, socket.user);

    const roles = Array.isArray(role) ? role : role ? [role] : ['RIDER'];
    const hasRiderRole = roles.includes('RIDER') || !driverId;
    const hasDriverRole = roles.includes('DRIVER') && Boolean(driverId);

    // 1. Register in riderSockets if user has RIDER capability
    if (hasRiderRole) {
      let rSockets = this.riderSockets.get(userId);
      if (!rSockets) {
        rSockets = new Set();
        this.riderSockets.set(userId, rSockets);
      }
      rSockets.add(socket);
    }

    // 2. Register in driverSockets if user has DRIVER capability
    if (hasDriverRole && driverId) {
      let dSockets = this.driverSockets.get(driverId);
      if (!dSockets) {
        dSockets = new Set();
        this.driverSockets.set(driverId, dSockets);
      }
      dSockets.add(socket);
    }
  }

  unregister(socket: AuthenticatedSocket): void {
    const user = this.socketUsers.get(socket);
    if (!user) return;

    this.socketUsers.delete(socket);

    const roles = Array.isArray(user.role) ? user.role : user.role ? [user.role] : ['RIDER'];
    const hasRiderRole = roles.includes('RIDER') || !user.driverId;
    const hasDriverRole = roles.includes('DRIVER') && Boolean(user.driverId);

    // 1. Unregister from riderSockets
    if (hasRiderRole) {
      const rSockets = this.riderSockets.get(user.userId);
      if (rSockets) {
        rSockets.delete(socket);
        if (rSockets.size === 0) {
          this.riderSockets.delete(user.userId);
        }
      }
    }

    // 2. Unregister from driverSockets
    if (hasDriverRole && user.driverId) {
      const dSockets = this.driverSockets.get(user.driverId);
      if (dSockets) {
        dSockets.delete(socket);
        if (dSockets.size === 0) {
          this.driverSockets.delete(user.driverId);
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
    return this.driverSockets.has(driverId);
  }

  isRiderOnline(riderId: string): boolean {
    return this.riderSockets.has(riderId);
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
      if (socket.readyState === socket.OPEN) {
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
