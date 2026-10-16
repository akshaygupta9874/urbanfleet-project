import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { RedisClientType } from 'redis';
import { createLogger } from '@urbanfleet/common';
import { GeoService } from '../services/geo.service.js';

const logger = createLogger('ride-websocket-server');

export function initRideWebSocketServer(
  server: http.Server,
  redis: RedisClientType,
  geoService: GeoService,
  publicKeyBase64?: string
) {
  const wss = new WebSocketServer({ noServer: true });
  const base64Key = publicKeyBase64 || process.env.JWT_PUBLIC_KEY_BASE64;
  const publicKey = base64Key ? Buffer.from(base64Key, 'base64').toString('utf-8') : '';

  // Intercept HTTP Upgrade request from Kong Gateway
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/ride') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized');
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
      socket.write('HTTP/1.1 401 Unauthorized');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage, user: any) => {
    logger.info(`WebSocket client connected: ${user.userId} (${user.role})`);

    // Keepalive ping/pong
    ws.on('message', async (data: string) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Handle live driver GPS telemetry
        if (payload.event === 'driver:location-update' && user.role === 'DRIVER') {
          const { lat, lng } = payload.data;
          await geoService.updateDriverLocation(user.userId, lat, lng);
        }
      } catch (e) {
        logger.warn('Unparseable WS message received:', { raw: data.toString() });
      }
    });

    ws.on('close', async () => {
      logger.info(`WebSocket client disconnected: ${user.userId}`);
      if (user.role === 'DRIVER') {
        // Ephemeral heartbeat will expire or can be explicitly removed
      }
    });
  });

  logger.info('Native WebSocket Upgrade Server initialized on /ws/ride');
  return wss;
}
