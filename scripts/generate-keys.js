#!/usr/bin/env node
/**
 * UrbanFleet RS256 Keypair Generator
 * Generates 2048-bit RSA keys for JWT token signing (Auth Service)
 * and verification (All Services).
 *
 * Usage:
 *   node scripts/generate-keys.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('Generating 2048-bit RS256 Keypair for UrbanFleet...');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const privateKeyBase64 = Buffer.from(privateKey, 'utf-8').toString('base64');
const publicKeyBase64 = Buffer.from(publicKey, 'utf-8').toString('base64');

// Ensure certs directory exists if saving PEM files
const certsDir = path.join(__dirname, '..', 'certs');
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
}

fs.writeFileSync(path.join(certsDir, 'private.pem'), privateKey, 'utf-8');
fs.writeFileSync(path.join(certsDir, 'public.pem'), publicKey, 'utf-8');

console.log('\nKeys saved to:');
console.log(` - certs/private.pem (Auth Service signing)`);
console.log(` - certs/public.pem  (Verification across services)`);

console.log('\n================================================================');
console.log('BASE64 ENCODED STRINGS (Copy to your .env or microservice .env):');
console.log('================================================================\n');

console.log('# Auth Service Only (Keep strictly secret):');
console.log(`JWT_PRIVATE_KEY_BASE64="${privateKeyBase64}"\n`);

console.log('# All Services (Auth, Driver, Ride, Payment, Notification):');
console.log(`JWT_PUBLIC_KEY_BASE64="${publicKeyBase64}"\n`);
console.log('================================================================\n');
