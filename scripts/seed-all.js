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
  const { createClient } = await import('redis');
  const redis = createClient({
    url: process.env.REDIS_URL || 'rediss://default:gQAAAAAAAbq5AAIgcDIzYTliZWY4ODExZTk0NDNjYWFlNWFhNDgwNzhlNjk2Yg@crisp-pelican-113337.upstash.io:6379'
  });
  await redis.connect();

  // Driver 1 (Alex - Mumbai): 19.0760, 72.8777
  await redis.geoAdd('ride:drivers:locations', { longitude: 72.8777, latitude: 19.0760, member: '44444444-4444-4444-4444-444444444444' });
  await redis.set('ride:driver:presence:44444444-4444-4444-4444-444444444444', JSON.stringify({ online: true, available: true, lastSeen: Date.now() }));
  await redis.set('driver:heartbeat:44444444-4444-4444-4444-444444444444', '1', { EX: 86400 });

  // Driver 2 (Rajesh - Bengaluru): 12.9716, 77.5946
  await redis.geoAdd('ride:drivers:locations', { longitude: 77.5946, latitude: 12.9716, member: '44444444-4444-4444-4444-444444444445' });
  await redis.set('ride:driver:presence:44444444-4444-4444-4444-444444444445', JSON.stringify({ online: true, available: true, lastSeen: Date.now() }));
  await redis.set('driver:heartbeat:44444444-4444-4444-4444-444444444445', '1', { EX: 86400 });

  await redis.disconnect();
  console.log('✅ Upstash Redis driver presence & GEO locations seeded successfully!');

  console.log('\n✨ ALL URBANFLEET MICROSERVICES SEEDED SUCCESSFULLY! ✨');
} catch (error) {
  console.error('\n❌ Error seeding services:', error);
  process.exit(1);
}
