import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { GeoService } from '../services/geo.service.js';
import { DriverPresenceService } from '../services/driver-presence.service.js';
import type { RideService } from '../services/ride.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import { AuthenticatedSocket, AuthenticatedSocketUser } from './types.js';
import { socketRegistry } from './registry/socket.registry.js';
import { registerSocketHandlers, configureDriverHandlers, configureRiderHandlers } from './handlers/index.js';
import { AuthPayload } from '../middlewares/auth.middleware.js';

const logger = createLogger('ride-websocket-server');

let globalWss: WebSocketServer | null = null;

export function getSocketRoles(userPayload: Pick<AuthPayload, 'role' | 'roles'>): string[] {
  const tokenRoles = Array.isArray(userPayload.roles)
    ? userPayload.roles
    : Array.isArray(userPayload.role)
    ? userPayload.role
    : userPayload.role
    ? [userPayload.role]
    : ['RIDER'];
  return tokenRoles.includes('DRIVER') && !tokenRoles.includes('RIDER')
    ? [...tokenRoles, 'RIDER']
    : tokenRoles;
}

export function initRideWebSocketServer(
  server: http.Server,
  redis: RedisClientType,
  geoService: GeoService,
  publicKeyBase64?: string,
  presenceService?: DriverPresenceService,
  rideService?: RideService,
  dispatchService?: DispatchService
) {
  const wss = new WebSocketServer({ noServer: true });
  globalWss = wss;

  const base64Key = publicKeyBase64 || process.env.JWT_PUBLIC_KEY_BASE64;
  const publicKey = base64Key ? Buffer.from(base64Key, 'base64').toString('utf-8') : '';

  const presence = presenceService || new DriverPresenceService(redis, geoService);
  geoService.setPresenceService(presence);

  // Configure handlers with shared services
  configureDriverHandlers({
    geoService,
    presenceService: presence,
    rideService,
    dispatchService,
  });

  if (rideService || dispatchService) {
    configureRiderHandlers({
      rideService,
      dispatchService,
    });
  }

  // Intercept HTTP Upgrade request from Kong Gateway
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const validPaths = ['/ws/ride', '/ws', '/'];
    if (!validPaths.includes(url.pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: 'urbanfleet-auth',
        audience: 'urbanfleet-api',
      }) as AuthPayload;

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, decoded);
      });
    } catch (err: unknown) {
      logger.warn('WebSocket upgrade authentication rejected', {
        error: err instanceof Error ? err.message : String(err),
      });
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage, userPayload: AuthPayload) => {
    const authenticatedSocket = ws as AuthenticatedSocket;
    const roles = getSocketRoles(userPayload);

    const user: AuthenticatedSocketUser = {
      userId: userPayload.userId || '',
      driverId: roles.includes('DRIVER') ? (userPayload.driverId || userPayload.userId) : undefined,
      role: roles,
      sessionId: userPayload.sessionId,
    };

    authenticatedSocket.user = user;
    logger.info(
      `WebSocket client connected: ${user.userId} (${user.role.join(', ')}) [driverId: ${user.driverId}]`
    );

    // 1. Register in in-memory dual-indexed socket registry
    socketRegistry.register(authenticatedSocket);

    // 2. Register complete event dispatcher and handlers
    registerSocketHandlers(authenticatedSocket);

    // 3. Socket close handling
    authenticatedSocket.on('close', async () => {
      logger.info(`WebSocket client disconnected: ${user.userId}`);
      socketRegistry.unregister(authenticatedSocket);

      if (user.role.includes('DRIVER') && user.driverId) {
        if (!socketRegistry.isDriverOnline(user.driverId)) {
          try {
            await presence.setDriverOffline(user.driverId);
            logger.info(`Driver ${user.driverId} marked OFFLINE on socket disconnect.`);
          } catch (err) {
            logger.error(`Failed to cleanup presence on disconnect for driver ${user.driverId}:`, err);
          }
        } else {
          logger.info(`Driver ${user.driverId} still has active socket connection(s); keeping presence online.`);
        }
      }
    });
  });

  logger.info('Native WebSocket Upgrade Server initialized on /ws/ride (with full socket architecture)');
  return wss;
}

export function getWebSocketServer(): WebSocketServer {
  if (!globalWss) {
    throw new Error('WebSocket server has not been initialized.');
  }
  return globalWss;
}

export { socketRegistry } from './registry/socket.registry.js';
export {
  emitToDriver,
  emitNewRideRequest,
  emitRideCancelled as emitDriverRideCancelled,
  emitPaymentCaptured as emitDriverPaymentCaptured,
} from './emitters/driver.emitter.js';
export {
  emitToRider,
  emitRideAccepted,
  emitDriverLocation,
  emitDriverArrived,
  emitRideStarted,
  emitArrivedAtDestination,
  emitRideCompleted,
  emitNoDriversAvailable,
  emitPaymentCaptured,
  emitRideCancelled,
} from './emitters/rider.emitter.js';
export * from './event.constants.js';
export * from './types.js';
