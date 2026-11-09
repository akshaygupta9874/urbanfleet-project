import { createLogger } from '@urbanfleet/common';
import { AuthenticatedSocket } from '../types/index.js';
import { SocketMessageSchema } from '../validators/socket.validator.js';
import { sendSocketError } from '../utils/send-error.js';
import {
  DriverEvents,
  RiderEvents,
  type DriverEvent,
  type RiderEvent,
} from '../event.constants.js';
import { handleDriverEvent } from './driver.handler.js';
import { handleRiderEvent } from './rider.handler.js';

const logger = createLogger('ride-websocket-dispatcher');

const DRIVER_EVENT_SET = new Set<string>(Object.values(DriverEvents));
const RIDER_EVENT_SET = new Set<string>(Object.values(RiderEvents));

export function registerDispatcher(socket: AuthenticatedSocket): void {
  socket.on('message', async (buffer) => {
    try {
      const parsed: unknown = JSON.parse(buffer.toString());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendSocketError(socket, 'Invalid WebSocket message.');
        return;
      }

      const raw = parsed as Record<string, unknown>;

      // Support ping/pong keepalive
      if (raw.type === 'ping' || raw.event === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      const eventName = raw.event ?? raw.type;
      const eventData = raw.data !== undefined ? raw.data : raw;

      const result = SocketMessageSchema.safeParse({
        event: eventName,
        data: eventData,
      });

      if (!result.success) {
        sendSocketError(socket, 'Invalid WebSocket message.');
        return;
      }

      const { event, data } = result.data;
      const userRoles = socket.user?.roles || [];
      const isDriver = userRoles.includes('DRIVER');
      const isRider = userRoles.includes('RIDER');

      // Handle driver events
      if (DRIVER_EVENT_SET.has(event)) {
        if (!isDriver) {
          sendSocketError(socket, 'Forbidden: Driver role required for this event.', 'FORBIDDEN');
          return;
        }
        await handleDriverEvent(socket, event as DriverEvent, data);
        return;
      }

      // Handle rider events
      if (RIDER_EVENT_SET.has(event)) {
        if (!isRider) {
          sendSocketError(socket, 'Forbidden: Rider role required for this event.', 'FORBIDDEN');
          return;
        }
        await handleRiderEvent(socket, event as RiderEvent, data);
        return;
      }

      // Legacy fallback mapping for direct telemetry types
      if (event === 'location_update' || event === 'UPDATE_LOCATION') {
        if (!isDriver) {
          sendSocketError(socket, 'Forbidden: Driver role required for this event.', 'FORBIDDEN');
          return;
        }
        await handleDriverEvent(socket, DriverEvents.UPDATE_LOCATION, data);
        return;
      }

      sendSocketError(socket, 'Unknown event.');
    } catch (error: unknown) {
      logger.warn('Error handling WebSocket message', {
        error: error instanceof Error ? error.message : String(error),
      });
      sendSocketError(socket, 'Invalid WebSocket message.');
    }
  });
}