import { PrismaClient, Role } from '../src/db/client.js';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const DEMO_RIDER_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_DRIVER_USER_ID = '22222222-2222-2222-2222-222222222222';
export const DEMO_ADMIN_ID = '33333333-3333-3333-3333-333333333333';

async function main() {
  console.log('🌱 Seeding urbanfleet_auth database...');
  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Demo Rider
  const rider = await prisma.user.upsert({
    where: { email: 'rider@urbanfleet.com' },
    update: { passwordHash, fullName: 'John Rider', role: Role.RIDER, isEmailVerified: true },
    create: {
      id: DEMO_RIDER_ID,
      email: 'rider@urbanfleet.com',
      passwordHash,
      fullName: 'John Rider',
      role: Role.RIDER,
      isEmailVerified: true
    }
  });
  console.log(`✅ Upserted Demo Rider: ${rider.email} (${rider.id})`);

  // 2. Demo Driver User
  const driver = await prisma.user.upsert({
    where: { email: 'driver@urbanfleet.com' },
    update: { passwordHash, fullName: 'Alex Driver', role: Role.DRIVER, isEmailVerified: true },
    create: {
      id: DEMO_DRIVER_USER_ID,
      email: 'driver@urbanfleet.com',
      passwordHash,
      fullName: 'Alex Driver',
      role: Role.DRIVER,
      isEmailVerified: true
    }
  });
  console.log(`✅ Upserted Demo Driver User: ${driver.email} (${driver.id})`);

  // 3. Demo Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@urbanfleet.com' },
    update: { passwordHash, fullName: 'Fleet Administrator', role: Role.ADMIN, isEmailVerified: true },
    create: {
      id: DEMO_ADMIN_ID,
      email: 'admin@urbanfleet.com',
      passwordHash,
      fullName: 'Fleet Administrator',
      role: Role.ADMIN,
      isEmailVerified: true
    }
  });
  console.log(`✅ Upserted Demo Admin: ${admin.email} (${admin.id})`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
