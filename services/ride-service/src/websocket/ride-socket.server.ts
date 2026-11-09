import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { GeoService } from '../services/geo.service.js';
import { DriverPresenceService } from '../services/driver-presence.service.js';
import type { RideService } from '../services/ride.service.js';
import type { DispatchService } from '../services/dispatch.service.js';
import { AuthenticatedSocket, AuthenticatedSocketUser } from './types/index.js';
import { socketRegistry } from './registry/socket.registry.js';
import {
  registerSocketHandlers,
  configureDriverHandlers,
  configureRiderHandlers,
} from './handlers/index.js';
import { configureDriverEmitter } from './emitters/driver.emitter.js';
import { configureRiderEmitter } from './emitters/rider.emitter.js';
import { AuthPayload } from '../middlewares/auth.middleware.js';

const logger = createLogger('ride-websocket-server');
const VALID_WS_PATHS = new Set(['/ws/ride', '/ws', '/']);

let globalWss: WebSocketServer | null = null;
let redisSubClient: RedisClientType | null = null;

export function getSocketRoles(userPayload: { roles?: string[]; role?: string | string[] }): string[] {
  const tokenRoles =
    Array.isArray(userPayload.roles) && userPayload.roles.length > 0
      ? userPayload.roles
      : typeof userPayload.role === 'string'
        ? [userPayload.role]
        : Array.isArray(userPayload.role) && userPayload.role.length > 0
          ? userPayload.role
          : ['RIDER'];

  return tokenRoles.includes('DRIVER') && !tokenRoles.includes('RIDER')
    ? [...tokenRoles, 'RIDER']
    : tokenRoles;
}

function extractUpgradeToken(request: http.IncomingMessage, url: URL): string | null {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() || null;
  }
  return null;
}

async function hasClusterDriverSubscribers(
  redis: RedisClientType,
  driverId: string
): Promise<boolean> {
  if (!redis?.isOpen || typeof redis.pubSubNumSub !== 'function') {
    return false;
  }
  try {
    const channel = `ws:driver:${driverId}`;
    const counts = await redis.pubSubNumSub(channel);
    return (counts?.[channel] ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function initRideWebSocketServer(
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

  // 1. Setup dedicated Redis Subscriber & Emitter Publisher
  if (redis && typeof redis.duplicate === 'function') {
    try {
      if (redisSubClient?.isOpen) {
        await redisSubClient.quit().catch(() => {});
      }
      redisSubClient = redis.duplicate();
      redisSubClient.on('error', (err) => {
        logger.error('Redis WebSocket subscriber client error', { error: err });
      });
      if (!redisSubClient.isOpen) {
        await redisSubClient.connect();
      }
      socketRegistry.setRedisSubscriber(redisSubClient);
    } catch (err) {
      logger.error('Failed to initialize dedicated Redis subscriber; running in local-only mode', {
        error: err,
      });
    }
  }

  configureDriverEmitter(redis);
  configureRiderEmitter(redis);

  // 2. Configure handlers with shared services
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

  // 3. Intercept HTTP Upgrade request
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (!VALID_WS_PATHS.has(url.pathname)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = extractUpgradeToken(request, url);
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

  // 4. Client Connection Lifecycle
  wss.on('connection', async (ws: WebSocket, _req: http.IncomingMessage, userPayload: AuthPayload) => {
    const authenticatedSocket = ws as AuthenticatedSocket;
    const roles = getSocketRoles(userPayload);

    const user: AuthenticatedSocketUser = {
      userId: userPayload.userId || '',
      driverId: roles.includes('DRIVER') ? (userPayload.driverId || userPayload.userId) : undefined,
      roles,
      sessionId: userPayload.sessionId,
    };

    authenticatedSocket.user = user;
    logger.info(
      `WebSocket client connected: ${user.userId} (${user.roles.join(', ')}) [driverId: ${user.driverId}]`
    );

    // Attach message & close listeners synchronously BEFORE awaiting Redis I/O
    registerSocketHandlers(authenticatedSocket);

    authenticatedSocket.on('close', async () => {
      logger.info(`WebSocket client disconnected: ${user.userId}`);
      await socketRegistry.unregister(authenticatedSocket);

      if (user.roles.includes('DRIVER') && user.driverId) {
        const stillOnlineLocally = socketRegistry.isDriverOnline(user.driverId);
        const stillOnlineInCluster =
          stillOnlineLocally || (await hasClusterDriverSubscribers(redis, user.driverId));

        if (!stillOnlineInCluster) {
          try {
            await presence.setDriverOffline(user.driverId);
            logger.info(`Driver ${user.driverId} marked OFFLINE on socket disconnect.`);
          } catch (err) {
            logger.error(`Failed to cleanup presence on disconnect for driver ${user.driverId}:`, err);
          }
        }
      }
    });

    await socketRegistry.register(authenticatedSocket);
  });

  logger.info('Native WebSocket Upgrade Server initialized on /ws/ride (Targeted Redis Pub/Sub enabled)');
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
  configureDriverEmitter,
  emitToDriver,
  emitNewRideRequest,
  emitRideCancelled as emitDriverRideCancelled,
  emitPaymentCaptured as emitDriverPaymentCaptured,
  type NewRideRequestPayload,
  type RideCancelledPayload,
  type PaymentCapturedPayload,
} from './emitters/driver.emitter.js';
export {
  configureRiderEmitter,
  emitToRider,
  emitRideAccepted,
  emitDriverLocation,
  emitDriverArrived,
  emitRideStarted,
  emitArrivedAtDestination,
  emitRideCompleted,
  emitPaymentCaptured as emitRiderPaymentCaptured,
  emitRideCancelled as emitRiderRideCancelled,
  emitNoDriversAvailable,
  type NoDriversAvailablePayload,
  type DriverLocationPayload,
  type RideCancelledPayload as RiderRideCancelledPayload,
  type PaymentCapturedPayload as RiderPaymentCapturedPayload,
} from './emitters/rider.emitter.js';
export * from './event.constants.js';
export * from './types/index.js';