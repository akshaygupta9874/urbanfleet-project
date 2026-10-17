import { AuthenticatedSocket } from '../types.js';
import { registerDispatcher } from './dispatcher.js';

export function registerSocketHandlers(socket: AuthenticatedSocket): void {
  registerDispatcher(socket);
}

export * from './driver.handler.js';
export * from './rider.handler.js';
export * from './dispatcher.js';
