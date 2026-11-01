import 'dotenv/config';

export interface ServiceUrls {
  auth: string;
  driver: string;
  ride: string;
  payment: string;
  notification: string;
}

export interface AdminConfig {
  port: number;
  frontendUrl: string;
  jwtPublicKeyBase64: string;
  jwtPublicKey?: string;
  services: ServiceUrls;
}

function resolvePublicKeyBase64(): string {
  const directBase64 = process.env.JWT_PUBLIC_KEY_BASE64 || '';
  if (directBase64) return directBase64;
  const rawPem = process.env.JWT_PUBLIC_KEY || '';
  if (rawPem) {
    return Buffer.from(rawPem, 'utf8').toString('base64');
  }
  return '';
}

export const config: AdminConfig = {
  port: Number(process.env.PORT) || 4006,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtPublicKeyBase64: resolvePublicKeyBase64(),
  services: {
    auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:4001',
    driver: process.env.DRIVER_SERVICE_URL || 'http://driver-service:4002',
    ride: process.env.RIDE_SERVICE_URL || 'http://ride-service:4004',
    payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:4005',
    notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4003',
  },
};
