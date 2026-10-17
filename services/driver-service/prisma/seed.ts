import { PrismaClient, VerificationStatus } from '../src/db/client.js';

const prisma = new PrismaClient();
const DEMO_DRIVER_USER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_DRIVER_PROFILE_ID = '44444444-4444-4444-4444-444444444444';

async function main() {
  console.log('🌱 Seeding urbanfleet_driver database...');

  // 1. Upsert Driver Profile
  const profile = await prisma.driverProfile.upsert({
    where: { userId: DEMO_DRIVER_USER_ID },
    update: {
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      rating: 4.95,
      totalTrips: 150,
      totalEarningsPaise: BigInt(4500000)
    },
    create: {
      id: DEMO_DRIVER_PROFILE_ID,
      userId: DEMO_DRIVER_USER_ID,
      licenseNumber: 'DL-9876543210',
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      rating: 4.95,
      totalTrips: 150,
      totalEarningsPaise: BigInt(4500000)
    }
  });
  console.log(`✅ Upserted Driver Profile: ${profile.id} for User: ${profile.userId}`);

  // 2. Upsert Vehicle
  const vehicle = await prisma.vehicle.upsert({
    where: { plateNumber: 'MH-02-UF-2026' },
    update: { driverProfileId: profile.id, category: 'SEDAN', isActive: true },
    create: {
      driverProfileId: profile.id,
      make: 'Toyota',
      model: 'Prius Hybrid',
      year: 2024,
      plateNumber: 'MH-02-UF-2026',
      color: 'Pearl White',
      category: 'SEDAN',
      isActive: true
    }
  });
  console.log(`✅ Upserted Vehicle: ${vehicle.plateNumber} (${vehicle.make} ${vehicle.model})`);

  // 3. Upsert Driving License Document
  await prisma.document.create({
    data: {
      driverProfileId: profile.id,
      type: 'DRIVING_LICENSE',
      documentUrl: 'https://res.cloudinary.com/urbanfleet/demo-license.jpg',
      status: VerificationStatus.VERIFIED
    }
  });
  console.log(`✅ Upserted Driver License Document`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
