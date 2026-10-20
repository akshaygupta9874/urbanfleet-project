import bcrypt from 'bcryptjs';

import type pg from 'pg';
import type { PrismaClient } from '../src/db/client.js';

let prisma: PrismaClient;
let pool: pg.Pool;

async function getClient() {
  try {
    return await import('../dist/db/client.js');
  } catch {
    return await import('../src/db/client.js');
  }
}

export const DEMO_RIDER_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_RIDER_2_ID = '11111111-1111-1111-1111-111111111112';
export const DEMO_DRIVER_USER_ID = '22222222-2222-2222-2222-222222222222';
export const DEMO_DRIVER_USER_2_ID = '22222222-2222-2222-2222-222222222223';
export const DEMO_ADMIN_ID = '33333333-3333-3333-3333-333333333333';

async function main() {
  console.log('🌱 Seeding urbanfleet_auth database...');
  const clientMod = await getClient();
  prisma = clientMod.prisma;
  pool = clientMod.pool;
  const Role = clientMod.Role;
  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Demo Rider 1
  const rider1 = await prisma.user.upsert({
    where: { email: 'rider@urbanfleet.com' },
    update: {
      passwordHash,
      firstName: 'John',
      lastName: 'Rider',
      phone: '+919876543210',
      role: Role.RIDER,
      isEmailVerified: true,
      status: 'ACTIVE'
    },
    create: {
      id: DEMO_RIDER_ID,
      email: 'rider@urbanfleet.com',
      passwordHash,
      firstName: 'John',
      lastName: 'Rider',
      phone: '+919876543210',
      role: Role.RIDER,
      isEmailVerified: true,
      status: 'ACTIVE'
    }
  });
  console.log(`✅ Upserted Demo Rider 1: ${rider1.email} (${rider1.id})`);

  // 2. Demo Rider 2
  const rider2 = await prisma.user.upsert({
    where: { email: 'rider2@urbanfleet.com' },
    update: {
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Rider',
      phone: '+919876543211',
      role: Role.RIDER,
      isEmailVerified: true,
      status: 'ACTIVE'
    },
    create: {
      id: DEMO_RIDER_2_ID,
      email: 'rider2@urbanfleet.com',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Rider',
      phone: '+919876543211',
      role: Role.RIDER,
      isEmailVerified: true,
      status: 'ACTIVE'
    }
  });
  console.log(`✅ Upserted Demo Rider 2: ${rider2.email} (${rider2.id})`);

  // 3. Demo Driver User 1
  const driver1 = await prisma.user.upsert({
    where: { email: 'driver@urbanfleet.com' },
    update: {
      passwordHash,
      firstName: 'Alex',
      lastName: 'Driver',
      phone: '+919876543220',
      role: Role.DRIVER,
      isEmailVerified: true,
      status: 'ACTIVE'
    },
    create: {
      id: DEMO_DRIVER_USER_ID,
      email: 'driver@urbanfleet.com',
      passwordHash,
      firstName: 'Alex',
      lastName: 'Driver',
      phone: '+919876543220',
      role: Role.DRIVER,
      isEmailVerified: true,
      status: 'ACTIVE'
    }
  });
  console.log(`✅ Upserted Demo Driver User 1: ${driver1.email} (${driver1.id})`);

  // 4. Demo Driver User 2
  const driver2 = await prisma.user.upsert({
    where: { email: 'driver2@urbanfleet.com' },
    update: {
      passwordHash,
      firstName: 'Rajesh',
      lastName: 'Kumar',
      phone: '+919876543221',
      role: Role.DRIVER,
      isEmailVerified: true,
      status: 'ACTIVE'
    },
    create: {
      id: DEMO_DRIVER_USER_2_ID,
      email: 'driver2@urbanfleet.com',
      passwordHash,
      firstName: 'Rajesh',
      lastName: 'Kumar',
      phone: '+919876543221',
      role: Role.DRIVER,
      isEmailVerified: true,
      status: 'ACTIVE'
    }
  });
  console.log(`✅ Upserted Demo Driver User 2: ${driver2.email} (${driver2.id})`);

  // 5. Demo Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@urbanfleet.com' },
    update: {
      passwordHash,
      firstName: 'Fleet',
      lastName: 'Administrator',
      phone: '+919876543230',
      role: Role.ADMIN,
      isEmailVerified: true,
      status: 'ACTIVE'
    },
    create: {
      id: DEMO_ADMIN_ID,
      email: 'admin@urbanfleet.com',
      passwordHash,
      firstName: 'Fleet',
      lastName: 'Administrator',
      phone: '+919876543230',
      role: Role.ADMIN,
      isEmailVerified: true,
      status: 'ACTIVE'
    }
  });
  console.log(`✅ Upserted Demo Admin: ${admin.email} (${admin.id})`);
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
