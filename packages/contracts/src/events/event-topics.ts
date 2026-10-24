export const EventTopics = {
  AUTH_EVENTS: 'urbanfleet.auth.events',
  DRIVER_EVENTS: 'urbanfleet.driver.events',
  RIDE_EVENTS: 'urbanfleet.ride.events',
  PAYMENT_EVENTS: 'urbanfleet.payment.events',
  NOTIFICATION_EVENTS: 'urbanfleet.notification.events',
  
  // Dead Letter Queues
  AUTH_DLQ: 'urbanfleet.auth.events.DLQ',
  DRIVER_DLQ: 'urbanfleet.driver.events.DLQ',
  RIDE_DLQ: 'urbanfleet.ride.events.DLQ',
  PAYMENT_DLQ: 'urbanfleet.payment.events.DLQ',
  NOTIFICATION_DLQ: 'urbanfleet.notification.events.DLQ'
} as const;
