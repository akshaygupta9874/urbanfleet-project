import { PrismaClient, RideStatus, RidePaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();
const DEMO_RIDER_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_DRIVER_PROFILE_ID = '44444444-4444-4444-4444-444444444444';
const DEMO_RIDE_ID = '33333333-3333-3333-3333-333333333333';
const DEMO_RATING_ID = '55555555-5555-5555-5555-555555555555';

async function main() {
  console.log('🌱 Seeding urbanfleet_ride database...');

  const sampleRide = await prisma.ride.upsert({
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
      completedAt: new Date()
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
      rideId: sampleRide.id,
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

  console.log(`✅ Upserted Historical Completed Ride: ${sampleRide.id}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
