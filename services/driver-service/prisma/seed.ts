import type pg from 'pg';
import type { PrismaClient, VerificationStatus as VerificationStatusEnum } from '../src/db/client.js';

let prisma: PrismaClient;
let VerificationStatus: typeof VerificationStatusEnum;
let pool: pg.Pool;

async function getClient() {
  try {
    return await import('../dist/db/client.js');
  } catch {
    return await import('../src/db/client.js');
  }
}

export const DEMO_DRIVER_USER_ID = '22222222-2222-2222-2222-222222222222';
export const DEMO_DRIVER_PROFILE_ID = '44444444-4444-4444-4444-444444444444';
export const DEMO_DRIVER_USER_2_ID = '22222222-2222-2222-2222-222222222223';
export const DEMO_DRIVER_PROFILE_2_ID = '44444444-4444-4444-4444-444444444445';

async function seedDriver(params: {
  profileId: string;
  userId: string;
  licenseNumber: string;
  rating: number;
  totalTrips: number;
  totalEarningsPaise: bigint;
  profilePhotoUrl: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    plateNumber: string;
    color: string;
    category: string;
    images?: Record<string, string>;
  };
  documents: Array<{
    type: string;
    number: string;
    documentUrl: string;
  }>;
}) {
  // 1. Upsert Driver Profile
  const profile = await prisma.driverProfile.upsert({
    where: { userId: params.userId },
    update: {
      licenseNumber: params.licenseNumber,
      verificationStatus: VerificationStatus.VERIFIED,
      isVerified: true,
      isAvailable: true,
      rating: params.rating,
      totalTrips: params.totalTrips,
      totalEarningsPaise: params.totalEarningsPaise,
      profilePhoto: {
        url: params.profilePhotoUrl,
        publicId: `profile_${params.profileId}`
      }
    },
    create: {
      id: params.profileId,
      userId: params.userId,
      licenseNumber: params.licenseNumber,
      verificationStatus: VerificationStatus.VERIFIED,
      isVerified: true,
      isAvailable: true,
      rating: params.rating,
      totalTrips: params.totalTrips,
      totalEarningsPaise: params.totalEarningsPaise,
      profilePhoto: {
        url: params.profilePhotoUrl,
        publicId: `profile_${params.profileId}`
      }
    }
  });
  console.log(`✅ Upserted Driver Profile: ${profile.id} for User: ${profile.userId}`);

  // 2. Upsert Vehicle
  const vehicle = await prisma.vehicle.upsert({
    where: { plateNumber: params.vehicle.plateNumber },
    update: {
      driverProfileId: profile.id,
      make: params.vehicle.make,
      model: params.vehicle.model,
      year: params.vehicle.year,
      color: params.vehicle.color,
      category: params.vehicle.category,
      isActive: true,
      images: params.vehicle.images || {}
    },
    create: {
      driverProfileId: profile.id,
      make: params.vehicle.make,
      model: params.vehicle.model,
      year: params.vehicle.year,
      plateNumber: params.vehicle.plateNumber,
      color: params.vehicle.color,
      category: params.vehicle.category,
      isActive: true,
      images: params.vehicle.images || {}
    }
  });
  console.log(`✅ Upserted Vehicle: ${vehicle.plateNumber} (${vehicle.make} ${vehicle.model} - ${vehicle.category})`);

  // 3. Clean and recreate verified documents
  await prisma.document.deleteMany({
    where: { driverProfileId: profile.id }
  });

  for (const doc of params.documents) {
    await prisma.document.create({
      data: {
        driverProfileId: profile.id,
        type: doc.type,
        number: doc.number,
        documentUrl: doc.documentUrl,
        frontImage: doc.documentUrl,
        status: VerificationStatus.VERIFIED,
        isVerified: true
      }
    });
  }
  console.log(`✅ Upserted ${params.documents.length} verified documents for driver ${profile.id}`);
}

async function main() {
  console.log('🌱 Seeding urbanfleet_driver database...');
  const clientMod = await getClient();
  prisma = clientMod.prisma;
  VerificationStatus = clientMod.VerificationStatus;
  pool = clientMod.pool;

  // 1. Seed Alex Driver (Sedan)
  await seedDriver({
    profileId: DEMO_DRIVER_PROFILE_ID,
    userId: DEMO_DRIVER_USER_ID,
    licenseNumber: 'DL-MH-2024-9876543',
    rating: 4.95,
    totalTrips: 128,
    totalEarningsPaise: BigInt(4500000),
    profilePhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    vehicle: {
      make: 'Toyota',
      model: 'Prius Hybrid',
      year: 2024,
      plateNumber: 'MH-02-UF-2026',
      color: 'Pearl White',
      category: 'SEDAN',
      images: {
        front: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=600&q=80',
        back: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=600&q=80',
        interior: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=600&q=80'
      }
    },
    documents: [
      { type: 'DRIVING_LICENSE', number: 'DL-MH-2024-9876543', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-dl-alex.jpg' },
      { type: 'REGISTRATION_CERTIFICATE', number: 'RC-MH-02-UF-2026', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-rc-alex.jpg' },
      { type: 'INSURANCE', number: 'INS-883719', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-ins-alex.jpg' },
      { type: 'POLLUTION', number: 'PUC-2026-001', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-puc-alex.jpg' }
    ]
  });

  // 2. Seed Rajesh Kumar (Bike)
  await seedDriver({
    profileId: DEMO_DRIVER_PROFILE_2_ID,
    userId: DEMO_DRIVER_USER_2_ID,
    licenseNumber: 'DL-KA-2024-1234567',
    rating: 4.88,
    totalTrips: 84,
    totalEarningsPaise: BigInt(2850000),
    profilePhotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    vehicle: {
      make: 'Royal Enfield',
      model: 'Hunter 350',
      year: 2024,
      plateNumber: 'KA-05-UF-3030',
      color: 'Rebel Blue',
      category: 'BIKE',
      images: {
        front: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=600&q=80',
        back: 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=600&q=80'
      }
    },
    documents: [
      { type: 'DRIVING_LICENSE', number: 'DL-KA-2024-1234567', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-dl-raj.jpg' },
      { type: 'REGISTRATION_CERTIFICATE', number: 'RC-KA-05-UF-3030', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-rc-raj.jpg' },
      { type: 'INSURANCE', number: 'INS-551920', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-ins-raj.jpg' },
      { type: 'POLLUTION', number: 'PUC-2026-002', documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-puc-raj.jpg' }
    ]
  });

  // 3. Seed Redis Driver Presence & GEO Coordinates
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = await import('redis');
      const redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();

      // Alex Driver (Mumbai): 19.0760, 72.8777
      await redisClient.geoAdd('ride:drivers:locations', {
        longitude: 72.8777,
        latitude: 19.0760,
        member: DEMO_DRIVER_PROFILE_ID
      });
      await redisClient.set(
        `ride:driver:presence:${DEMO_DRIVER_PROFILE_ID}`,
        JSON.stringify({ online: true, available: true, lastSeen: Date.now() })
      );
      await redisClient.set(`driver:heartbeat:${DEMO_DRIVER_PROFILE_ID}`, '1', { EX: 3600 });

      // Rajesh Driver (Bengaluru): 12.9716, 77.5946
      await redisClient.geoAdd('ride:drivers:locations', {
        longitude: 77.5946,
        latitude: 12.9716,
        member: DEMO_DRIVER_PROFILE_2_ID
      });
      await redisClient.set(
        `ride:driver:presence:${DEMO_DRIVER_PROFILE_2_ID}`,
        JSON.stringify({ online: true, available: true, lastSeen: Date.now() })
      );
      await redisClient.set(`driver:heartbeat:${DEMO_DRIVER_PROFILE_2_ID}`, '1', { EX: 3600 });

      console.log('✅ Seeded Redis driver presence & geo coordinates');
      await redisClient.disconnect();
    } catch (redisErr) {
      console.warn('⚠️ Could not seed Redis driver locations (non-fatal):', redisErr);
    }
  }
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
