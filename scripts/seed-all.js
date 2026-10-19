import { execSync } from 'child_process';

console.log('====================================================');
console.log('🚀 Seeding All UrbanFleet Microservices & Redis');
console.log('====================================================\n');

try {
  // 1. Auth Service
  console.log('1️⃣  Seeding Auth Service (urbanfleet_auth)...');
  execSync('docker cp services/auth-service/prisma/seed.ts urbanfleet-auth-service:/app/prisma/seed.ts', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-auth-service npx tsx prisma/seed.ts', { stdio: 'inherit' });

  // 2. Driver Service
  console.log('\n2️⃣  Seeding Driver Service (urbanfleet_driver)...');
  execSync('docker cp services/driver-service/prisma/seed.ts urbanfleet-driver-service:/app/prisma/seed.ts', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-driver-service npx tsx prisma/seed.ts', { stdio: 'inherit' });

  // 3. Ride Service
  console.log('\n3️⃣  Seeding Ride Service (urbanfleet_ride)...');
  execSync('docker cp services/ride-service/prisma/seed.ts urbanfleet-ride-service:/app/prisma/seed.ts', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-ride-service npx tsx prisma/seed.ts', { stdio: 'inherit' });

  // 4. Payment Service
  console.log('\n4️⃣  Seeding Payment Service (urbanfleet_payment)...');
  execSync('docker cp services/payment-service/prisma/seed.ts urbanfleet-payment-service:/app/prisma/seed.ts', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-payment-service npx tsx prisma/seed.ts', { stdio: 'inherit' });

  // 5. Redis Driver Presence & Geo
  console.log('\n5️⃣  Seeding Redis Driver Presence & GEO Coordinates...');
  // Driver 1 (Alex - Mumbai): 19.0760, 72.8777
  execSync('docker exec urbanfleet-redis redis-cli GEOADD ride:drivers:locations 72.8777 19.0760 44444444-4444-4444-4444-444444444444', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-redis redis-cli SET ride:driver:presence:44444444-4444-4444-4444-444444444444 "{\\"online\\":true,\\"available\\":true,\\"lastSeen\\":' + Date.now() + '}"', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-redis redis-cli SET driver:heartbeat:44444444-4444-4444-4444-444444444444 1 EX 3600', { stdio: 'inherit' });

  // Driver 2 (Rajesh - Bengaluru): 12.9716, 77.5946
  execSync('docker exec urbanfleet-redis redis-cli GEOADD ride:drivers:locations 77.5946 12.9716 44444444-4444-4444-4444-444444444445', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-redis redis-cli SET ride:driver:presence:44444444-4444-4444-4444-444444444445 "{\\"online\\":true,\\"available\\":true,\\"lastSeen\\":' + Date.now() + '}"', { stdio: 'inherit' });
  execSync('docker exec urbanfleet-redis redis-cli SET driver:heartbeat:44444444-4444-4444-4444-444444444445 1 EX 3600', { stdio: 'inherit' });

  console.log('\n✨ ALL URBANFLEET MICROSERVICES SEEDED SUCCESSFULLY! ✨');
} catch (error) {
  console.error('\n❌ Error seeding services:', error);
  process.exit(1);
}
