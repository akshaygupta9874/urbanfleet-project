import { AuthenticatedSocket } from '../types.js';
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

export function registerDispatcher(socket: AuthenticatedSocket): void {
  socket.on('message', async (buffer) => {
    try {
      const parsed = JSON.parse(buffer.toString());

      // Support ping/pong keepalive
      if (parsed.type === 'ping' || parsed.event === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      // Canonical event name
      const eventName = parsed.event;
      const eventData = parsed.data !== undefined ? parsed.data : parsed;

      const result = SocketMessageSchema.safeParse({
        event: eventName,
        data: eventData,
      });

      if (!result.success) {
        sendSocketError(socket, 'Invalid WebSocket message.');
        return;
      }

      const { event, data } = result.data;
      const userRoles = socket.user?.role || [];
      const isDriver = userRoles.includes('DRIVER');
      const isRider = userRoles.includes('RIDER') || userRoles.includes('ADMIN');

      // Handle driver events
      if (Object.values(DriverEvents).includes(event as DriverEvent)) {
        if (!isDriver) {
          sendSocketError(socket, 'Forbidden: Driver role required for this event.', 'FORBIDDEN');
          return;
        }
        await handleDriverEvent(socket, event as DriverEvent, data);
        return;
      }

      // Handle rider events
      if (Object.values(RiderEvents).includes(event as RiderEvent)) {
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
          sendSocketError(socket, 'Forbidden: Driver role required for this event.');
          return;
        }
        await handleDriverEvent(socket, DriverEvents.UPDATE_LOCATION, data);
        return;
      }

      sendSocketError(socket, 'Unknown event.');
    } catch (error) {
      sendSocketError(socket, 'Invalid WebSocket message.');
    }
  });
}
