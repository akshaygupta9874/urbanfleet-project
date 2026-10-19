let prisma: any;
let pool: any;

async function getClient() {
  try {
    return await import('../dist/db/client.js');
  } catch {
    return await import('../src/db/client.js');
  }
}

export const DEMO_RIDER_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_RIDER_2_ID = '11111111-1111-1111-1111-111111111112';
export const DEMO_DRIVER_PROFILE_ID = '44444444-4444-4444-4444-444444444444';
export const DEMO_DRIVER_PROFILE_2_ID = '44444444-4444-4444-4444-444444444445';
export const DEMO_RIDE_ID = '33333333-3333-3333-3333-333333333333';
export const DEMO_RIDE_2_ID = '33333333-3333-3333-3333-333333333334';
export const DEMO_RATING_ID = '55555555-5555-5555-5555-555555555555';
export const DEMO_RATING_2_ID = '55555555-5555-5555-5555-555555555556';

async function main() {
  console.log('🌱 Seeding urbanfleet_ride database...');
  const clientMod = await getClient();
  prisma = clientMod.prisma;
  pool = clientMod.pool;
  const RideStatus = clientMod.RideStatus;
  const RidePaymentStatus = clientMod.RidePaymentStatus;

  // 1. First sample ride (Sedan in Mumbai)
  const sampleRide1 = await prisma.ride.upsert({
    where: { id: DEMO_RIDE_ID },
    create: {
      id: DEMO_RIDE_ID,
      riderId: DEMO_RIDER_ID,
      driverId: DEMO_DRIVER_PROFILE_ID,
      pickupLat: 19.0760,
      pickupLng: 72.8777,
      pickupAddress: 'Bandra Kurla Complex, Mumbai',
      destinationLat: 19.0896,
      destinationLng: 72.8656,
      destinationAddress: 'Chhatrapati Shivaji Maharaj International Airport (BOM)',
      distanceKm: 6.5,
      durationMinutes: 18,
      baseFarePaise: 5000,
      surgeMultiplier: 1.2,
      totalFarePaise: 14750,
      status: RideStatus.COMPLETED,
      paymentStatus: RidePaymentStatus.CAPTURED,
      rideSequence: 4,
      completedAt: new Date(Date.now() - 3600000 * 2)
    },
    update: {
      status: RideStatus.COMPLETED,
      paymentStatus: RidePaymentStatus.CAPTURED
    }
  });

  await prisma.rating.upsert({
    where: {
      rideId_fromId: {
        rideId: DEMO_RIDE_ID,
        fromId: DEMO_RIDER_ID
      }
    },
    create: {
      id: DEMO_RATING_ID,
      rideId: sampleRide1.id,
      fromId: DEMO_RIDER_ID,
      toId: DEMO_DRIVER_PROFILE_ID,
      score: 5,
      feedback: 'Excellent driving and very clean hybrid vehicle!'
    },
    update: {
      score: 5,
      feedback: 'Excellent driving and very clean hybrid vehicle!'
    }
  });
  console.log(`✅ Upserted Historical Completed Ride 1: ${sampleRide1.id}`);

  // 2. Second sample ride (Bike in Bengaluru)
  const sampleRide2 = await prisma.ride.upsert({
    where: { id: DEMO_RIDE_2_ID },
    create: {
      id: DEMO_RIDE_2_ID,
      riderId: DEMO_RIDER_2_ID,
      driverId: DEMO_DRIVER_PROFILE_2_ID,
      pickupLat: 12.9716,
      pickupLng: 77.5946,
      pickupAddress: 'MG Road Metro Station, Bengaluru',
      destinationLat: 12.9352,
      destinationLng: 77.6245,
      destinationAddress: 'Koramangala Sony World Signal, Bengaluru',
      distanceKm: 5.2,
      durationMinutes: 15,
      baseFarePaise: 3000,
      surgeMultiplier: 1.0,
      totalFarePaise: 7500,
      status: RideStatus.COMPLETED,
      paymentStatus: RidePaymentStatus.CAPTURED,
      rideSequence: 2,
      completedAt: new Date(Date.now() - 3600000 * 4)
    },
    update: {
      status: RideStatus.COMPLETED,
      paymentStatus: RidePaymentStatus.CAPTURED
    }
  });

  await prisma.rating.upsert({
    where: {
      rideId_fromId: {
        rideId: DEMO_RIDE_2_ID,
        fromId: DEMO_RIDER_2_ID
      }
    },
    create: {
      id: DEMO_RATING_2_ID,
      rideId: sampleRide2.id,
      fromId: DEMO_RIDER_2_ID,
      toId: DEMO_DRIVER_PROFILE_2_ID,
      score: 5,
      feedback: 'Punctual and very quick ride through traffic!'
    },
    update: {
      score: 5,
      feedback: 'Punctual and very quick ride through traffic!'
    }
  });
  console.log(`✅ Upserted Historical Completed Ride 2: ${sampleRide2.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  });
