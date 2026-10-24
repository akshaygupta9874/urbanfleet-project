const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

function getVal(key) {
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(key + '=')) {
      return line.substring(key.length + 1).replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const priv = getVal('JWT_PRIVATE_KEY_BASE64');
const pub = getVal('JWT_PUBLIC_KEY_BASE64');

if (!priv || !pub) {
  console.log('Keys missing in .env');
  process.exit(1);
}

const privPem = Buffer.from(priv, 'base64').toString('utf8');
const pubPem = Buffer.from(pub, 'base64').toString('utf8');

const sign = crypto.createSign('SHA256');
sign.update('UrbanFleet Test Payload');
const signature = sign.sign(privPem, 'hex');

const verify = crypto.createVerify('SHA256');
verify.update('UrbanFleet Test Payload');
const isValid = verify.verify(pubPem, signature, 'hex');

console.log('RSA Keypair in .env test:', isValid ? 'PASSED (Signature verified)' : 'FAILED');

// Verify database URLs
const dbs = [
  'AUTH_DATABASE_URL',
  'DRIVER_DATABASE_URL',
  'RIDE_DATABASE_URL',
  'PAYMENT_DATABASE_URL',
  'NOTIFICATION_DATABASE_URL',
];

for (const db of dbs) {
  const val = getVal(db);
  console.log(`${db}: ${val && val.startsWith('postgresql://') ? 'Valid PostgreSQL URL' : 'Missing/Invalid'}`);
}
