import 'dotenv/config';

export interface ServiceUrls {
  driver: string;
  ride: string;
  payment: string;
  notification: string;
}

export interface AuthServiceConfig {
  frontendUrl: string;
  services: ServiceUrls;
}

export const config: AuthServiceConfig = {
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  services: {
    driver: process.env.DRIVER_SERVICE_URL || 'http://driver-service:4002',
    ride: process.env.RIDE_SERVICE_URL || 'http://ride-service:4004',
    payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:4005',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4003',
  },
};
