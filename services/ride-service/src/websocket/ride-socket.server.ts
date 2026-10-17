import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { GeoService } from '../services/geo.service.js';
import { DriverPresenceService } from '../services/driver-presence.service.js';

const logger = createLogger('ride-websocket-server');

export function initRideWebSocketServer(
  server: http.Server,
  redis: RedisClientType,
  geoService: GeoService,
  publicKeyBase64?: string,
  presenceService?: DriverPresenceService
) {
  const wss = new WebSocketServer({ noServer: true });
  const base64Key = publicKeyBase64 || process.env.JWT_PUBLIC_KEY_BASE64;
  const publicKey = base64Key ? Buffer.from(base64Key, 'base64').toString('utf-8') : '';

  const presence = presenceService || new DriverPresenceService(redis, geoService);
  geoService.setPresenceService(presence);

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
        audience: 'urbanfleet-api'
      }) as any;

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, decoded);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage, user: any) => {
    const driverId = user.driverId || user.userId;
    logger.info(`WebSocket client connected: ${user.userId} (${user.role}) [driverId: ${driverId}]`);

    // Handle messages
    ws.on('message', async (data: string) => {
      try {
        const payload = JSON.parse(data.toString());
        const eventType = payload.event || payload.type;

        // 1. Keepalive ping/pong
        if (eventType === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // 2. Driver Presence Events (only applicable for DRIVER role)
        if (user.role === 'DRIVER') {
          // A. GO ONLINE
          if (
            eventType === 'driver:go-online' ||
            eventType === 'GO_ONLINE' ||
            eventType === 'go_online'
          ) {
            const current = await presence.setDriverOnline(driverId);
            ws.send(
              JSON.stringify({
                event: 'server:driver-status',
                data: {
                  status: 'ONLINE',
                  isOnline: current.online,
                  isAvailable: current.available,
                  driverId,
                  timestamp: current.lastSeen,
                },
              })
            );
            return;
          }

          // B. SET AVAILABLE / TOGGLE AVAILABILITY
          if (
            eventType === 'driver:set-available' ||
            eventType === 'SET_AVAILABLE' ||
            eventType === 'set_available'
          ) {
            const requestedAvailable =
              payload.data?.available !== undefined
                ? Boolean(payload.data.available)
                : payload.available !== undefined
                ? Boolean(payload.available)
                : true;

            const current = await presence.setDriverAvailable(driverId, requestedAvailable);
            ws.send(
              JSON.stringify({
                event: 'server:driver-status',
                data: {
                  status: requestedAvailable ? 'AVAILABLE' : 'ONLINE',
                  isOnline: current.online,
                  isAvailable: current.available,
                  driverId,
                  timestamp: current.lastSeen,
                },
              })
            );
            return;
          }

          // C. SET BUSY
          if (
            eventType === 'driver:set-busy' ||
            eventType === 'SET_BUSY' ||
            eventType === 'set_busy'
          ) {
            const current = await presence.setDriverBusy(driverId);
            ws.send(
              JSON.stringify({
                event: 'server:driver-status',
                data: {
                  status: 'BUSY',
                  isOnline: current.online,
                  isAvailable: current.available,
                  driverId,
                  timestamp: current.lastSeen,
                },
              })
            );
            return;
          }

          // D. GO OFFLINE
          if (
            eventType === 'driver:go-offline' ||
            eventType === 'driver:set-offline' ||
            eventType === 'GO_OFFLINE' ||
            eventType === 'SET_OFFLINE' ||
            eventType === 'go_offline'
          ) {
            await presence.setDriverOffline(driverId);
            ws.send(
              JSON.stringify({
                event: 'server:driver-status',
                data: {
                  status: 'OFFLINE',
                  isOnline: false,
                  isAvailable: false,
                  driverId,
                  timestamp: Date.now(),
                },
              })
            );
            return;
          }

          // E. HEARTBEAT
          if (
            eventType === 'driver:heartbeat' ||
            eventType === 'HEARTBEAT' ||
            eventType === 'heartbeat'
          ) {
            const current = await presence.updateHeartbeat(driverId);
            ws.send(
              JSON.stringify({
                event: 'server:heartbeat-ack',
                data: {
                  timestamp: current?.lastSeen || Date.now(),
                  isOnline: current?.online ?? false,
                  isAvailable: current?.available ?? false,
                },
              })
            );
            return;
          }
        }

        // 3. Driver GPS telemetry (supports both event shapes)
        const isLocationEvent =
          eventType === 'driver:location-update' ||
          eventType === 'driver:update-location' ||
          eventType === 'UPDATE_LOCATION' ||
          eventType === 'location_update';

        if (isLocationEvent && user.role === 'DRIVER') {
          const lat =
            payload.data?.lat ?? payload.data?.latitude ?? payload.lat ?? payload.latitude;
          const lon =
            payload.data?.lng ?? payload.data?.longitude ?? payload.lng ?? payload.longitude;
          if (lat != null && lon != null) {
            await geoService.updateDriverLocation(driverId, Number(lat), Number(lon));
            await presence.updateHeartbeat(driverId);
          }
          return;
        }
      } catch (e) {
        logger.warn('Unparseable WS message received:', { raw: data.toString() });
      }
    });

    // 4. Automatic disconnection cleanup
    ws.on('close', async () => {
      logger.info(`WebSocket client disconnected: ${user.userId}`);
      if (user.role === 'DRIVER') {
        try {
          await presence.setDriverOffline(driverId);
          logger.info(`Driver ${driverId} marked OFFLINE on socket disconnect.`);
        } catch (err) {
          logger.error(`Failed to cleanup presence on disconnect for driver ${driverId}:`, err);
        }
      }
    });
  });

  logger.info('Native WebSocket Upgrade Server initialized on /ws/ride (with driver presence)');
  return wss;
}
