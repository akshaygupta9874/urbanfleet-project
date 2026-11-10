import { execSync } from 'child_process';
import path from 'path';
import 'dotenv/config';

console.log('====================================================');
console.log('🚀 Seeding All UrbanFleet Microservices & Redis');
console.log('====================================================\n');

function runSeed(serviceDir, containerName) {
  let isContainerRunning = false;
  try {
    const running = execSync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, { encoding: 'utf-8' }).trim();
    if (running.includes(containerName)) {
      isContainerRunning = true;
    }
  } catch {
    isContainerRunning = false;
  }

  if (isContainerRunning) {
    console.log(`🐳 Seeding via Docker container [${containerName}]...`);
    execSync(`docker cp ${serviceDir}/prisma/seed.ts ${containerName}:/app/prisma/seed.ts`, { stdio: 'inherit' });
    execSync(`docker exec ${containerName} npx tsx prisma/seed.ts`, { stdio: 'inherit' });
  } else {
    console.log(`💻 Seeding locally via host Node.js runtime [${serviceDir}]...`);
    execSync('npx tsx prisma/seed.ts', {
      cwd: path.resolve(serviceDir),
      stdio: 'inherit',
      env: { ...process.env }
    });
  }
}

try {
  // 1. Auth Service
  console.log('1️⃣  Seeding Auth Service (urbanfleet_auth)...');
  runSeed('services/auth-service', 'urbanfleet-auth-service');

  // 2. Driver Service
  console.log('\n2️⃣  Seeding Driver Service (urbanfleet_driver)...');
  runSeed('services/driver-service', 'urbanfleet-driver-service');

  // 3. Ride Service
  console.log('\n3️⃣  Seeding Ride Service (urbanfleet_ride)...');
  runSeed('services/ride-service', 'urbanfleet-ride-service');

  // 4. Payment Service
  console.log('\n4️⃣  Seeding Payment Service (urbanfleet_payment)...');
  runSeed('services/payment-service', 'urbanfleet-payment-service');

  // 5. Redis Driver Presence & Geo
  console.log('\n5️⃣  Seeding Redis Driver Presence & Geospatial Coordinates (Redis GEO + Uber H3)...');
  const { createClient } = await import('redis');
  const redisUrl = process.env.REDIS_URL || 'rediss://default:gQAAAAAAAbq5AAIgcDJkMDlkNjQ1YjE1OTI0NzdhYTVjZjFiNGEyZmEyMzYyMA@crisp-pelican-113337.upstash.io:6379';
  const redis = createClient({
    url: redisUrl
  });
  await redis.connect();

  let h3;
  try {
    h3 = await import('h3-js');
  } catch {
    try {
      h3 = await import('../services/ride-service/node_modules/h3-js/dist/h3-js.es.js');
    } catch {
      // fallback
    }
  }

  const drivers = [
    {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Alex (Mumbai)',
      lat: 19.0760,
      lng: 72.8777
    },
    {
      id: '44444444-4444-4444-4444-444444444445',
      name: 'Rajesh (Bengaluru)',
      lat: 12.9716,
      lng: 77.5946
    }
  ];

  for (const driver of drivers) {
    // Legacy Redis GEO
    await redis.geoAdd('ride:drivers:locations', { longitude: driver.lng, latitude: driver.lat, member: driver.id });
    
    // Presence & Heartbeat
    await redis.set(`ride:driver:presence:${driver.id}`, JSON.stringify({ online: true, available: true, lastSeen: Date.now() }));
    await redis.set(`driver:heartbeat:${driver.id}`, '1', { EX: 86400 });

    // H3 Spatial Index
    if (h3 && (h3.latLngToCell || h3.geoToH3)) {
      const getCell = h3.latLngToCell || h3.geoToH3;
      const cell = getCell(driver.lat, driver.lng, 9);
      await redis.hSet(`ride:driver:location:${driver.id}`, {
        lat: driver.lat.toString(),
        lng: driver.lng.toString(),
        cell: cell,
        resolution: '9',
        updatedAt: Date.now().toString(),
        sequence: '1'
      });
      await redis.expire(`ride:driver:location:${driver.id}`, 86400);
      await redis.zAdd(`ride:drivers:h3:9:${cell}`, [{ score: Date.now(), value: driver.id }]);
      console.log(`   📍 Driver ${driver.name}: [${driver.lat}, ${driver.lng}] -> H3 Cell [${cell}]`);
    }
  }

  await redis.disconnect();
  console.log('✅ Upstash Redis driver presence & Geospatial (GEO + H3) locations seeded successfully!');

  console.log('\n✨ ALL URBANFLEET MICROSERVICES SEEDED SUCCESSFULLY! ✨');
} catch (error) {
  console.error('\n❌ Error seeding services:', error);
  process.exit(1);
}
