/**
 * Unified WebSocket Module for UrbanFleet Ride Service
 *
 * Centralizes WebSocket server initialization, dual-indexed in-memory registry,
 * inbound message dispatchers, domain event handlers, and outbound emitters.
 */

export {
  initRideWebSocketServer,
  getSocketRoles,
  getWebSocketServer,
} from './ride-socket.server.js';
export { SocketRegistry, socketRegistry } from './registry/socket.registry.js';
export * from './event.constants.js';
export * from './types/index.js';

// Explicit domain-specific emitter exports to avoid duplicate symbol collision
export {
  configureDriverEmitter,
  emitToDriver,
  emitNewRideRequest,
  emitRideCancelled as emitDriverRideCancelled,
  emitPaymentCaptured as emitDriverPaymentCaptured,
  type NewRideRequestPayload,
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
} from './emitters/rider.emitter.js';

export * from './handlers/index.js';
export * from './utils/send-error.js';
