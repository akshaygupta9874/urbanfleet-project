import { v2 as cloudinary } from 'cloudinary';
import 'dotenv/config';

// import dns from 'node:dns';
// import http from 'node:http';
// import https from 'node:https';

// try {
//   if (typeof dns.setDefaultResultOrder === 'function') {
//     dns.setDefaultResultOrder('ipv4first');
//   }
//   const httpAgent = http.globalAgent as any;
//   if (httpAgent && httpAgent.options) {
//     httpAgent.options.autoSelectFamily = false;
//   }
//   const httpsAgent = https.globalAgent as any;
//   if (httpsAgent && httpsAgent.options) {
//     httpsAgent.options.autoSelectFamily = false;
//   }
// } catch {
//   // Ignore in environments where network options cannot be configured
// }

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || (isTestEnv ? 'test-cloud' : undefined);
const apiKey = process.env.CLOUDINARY_API_KEY || (isTestEnv ? 'test-api-key' : undefined);
const apiSecret = process.env.CLOUDINARY_API_SECRET || (isTestEnv ? 'test-api-secret' : undefined);

export const isCloudinaryConfigured = Boolean(
  cloudName &&
  apiKey &&
  apiSecret
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export default cloudinary;
