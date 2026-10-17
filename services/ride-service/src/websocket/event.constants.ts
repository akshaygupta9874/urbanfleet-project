// sockets/event.constants.ts
export const DriverEvents = {
  GO_ONLINE: 'driver:go-online',
  GO_OFFLINE: 'driver:go-offline',
  UPDATE_LOCATION: 'driver:update-location',
  SET_AVAILABLE: 'driver:set-available',
  SET_BUSY: 'driver:set-busy',
  SET_OFFLINE: 'driver:set-offline',
  HEARTBEAT: 'driver:heartbeat',
  ACCEPT_RIDE: 'driver:accept-ride',
  REJECT_RIDE: 'driver:reject-ride',
  ARRIVED_AT_PICKUP: 'driver:arrived-at-pickup',
  ARRIVED_AT_DESTINATION: 'driver:arrived-at-destination',
  START_RIDE: 'driver:start-ride',
  COMPLETE_RIDE: 'driver:complete-ride',
  CANCEL_RIDE_BY_DRIVER: 'driver:cancel-ride',
} as const;

export const RiderEvents = {
  REQUEST_RIDE: 'rider:request-ride',
  CANCEL_RIDE: 'rider:cancel-ride',
  UPDATE_LOCATION: 'rider:update-location',
} as const;

export const ServerEvents = {
  NEW_RIDE: 'server:new-ride',
  RIDE_ACCEPTED: 'server:ride-accepted',
  RIDE_NO_DRIVERS_AVAILABLE: 'server:ride-no-drivers-available',
  DRIVER_LOCATION: 'server:driver-location',
  DRIVER_ARRIVED: 'server:driver-arrived',
  ARRIVED_AT_DESTINATION: 'server:ride-arrived-at-destination',
  PAYMENT_CAPTURED: 'server:payment-captured',
  RIDE_STARTED: 'server:ride-started',
  RIDE_COMPLETED: 'server:ride-completed',
  RIDE_CANCELLED: 'server:ride-cancelled',
  ERROR: 'server:error',
  DRIVER_STATUS: 'server:driver-status',
  HEARTBEAT_ACK: 'server:heartbeat-ack',
} as const;

export type DriverEvent = (typeof DriverEvents)[keyof typeof DriverEvents];
export type RiderEvent = (typeof RiderEvents)[keyof typeof RiderEvents];
export type ServerEvent = (typeof ServerEvents)[keyof typeof ServerEvents];
