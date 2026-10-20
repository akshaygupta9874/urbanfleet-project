import { v2 as cloudinary } from 'cloudinary';
import 'dotenv/config';

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
  const httpAgent = http.globalAgent as any;
  if (httpAgent && httpAgent.options) {
    httpAgent.options.autoSelectFamily = false;
  }
  const httpsAgent = https.globalAgent as any;
  if (httpsAgent && httpsAgent.options) {
    httpsAgent.options.autoSelectFamily = false;
  }
} catch {
  // Ignore in environments where network options cannot be configured
}

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;

export const isCloudinaryConfigured = Boolean(
  CLOUDINARY_CLOUD_NAME &&
  CLOUDINARY_API_KEY &&
  CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export default cloudinary;
