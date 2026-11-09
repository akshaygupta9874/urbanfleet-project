import { WebSocket } from 'ws';
import { ServerEvents } from '../event.constants.js';

export function sendSocketMessage<T>(
  socket: WebSocket,
  event: string,
  data: T
): void {
  if (socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ event, data }));
    } catch {
      // Ignore send errors on closing sockets
    }
  }
}

export function sendSocketError(
  socket: WebSocket,
  message: string,
  code: string = 'BAD_REQUEST'
): void {
  sendSocketMessage(socket, ServerEvents.ERROR, { message, code });
}