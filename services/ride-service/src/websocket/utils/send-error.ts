import { AuthenticatedSocket } from '../types.js';
import { ServerEvents } from '../event.constants.js';

export function sendSocketError(
  socket: AuthenticatedSocket,
  message: string,
  code?: string
): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(
      JSON.stringify({
        event: ServerEvents.ERROR,
        data: {
          message,
          code,
        },
      })
    );
  }
}
