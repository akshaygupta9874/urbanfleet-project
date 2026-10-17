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

      // Normalize event name from either 'event' or 'type'
      const eventName = parsed.event || parsed.type;
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

      // Handle driver events
      if (Object.values(DriverEvents).includes(event as DriverEvent)) {
        await handleDriverEvent(socket, event as DriverEvent, data);
        return;
      }

      // Handle rider events
      if (Object.values(RiderEvents).includes(event as RiderEvent)) {
        await handleRiderEvent(socket, event as RiderEvent, data);
        return;
      }

      // Legacy fallback mapping for direct telemetry types
      if (event === 'location_update' || event === 'UPDATE_LOCATION') {
        await handleDriverEvent(socket, DriverEvents.UPDATE_LOCATION, data);
        return;
      }

      sendSocketError(socket, 'Unknown event.');
    } catch (error) {
      sendSocketError(socket, 'Invalid WebSocket message.');
    }
  });
}
