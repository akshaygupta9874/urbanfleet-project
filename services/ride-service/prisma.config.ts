import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/**
 * RIDE-SERVICE - Dedicated Prisma Configuration
 * Completely standalone configuration decoupled from shared packages.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://ride_user:ride_secure_pass@localhost:5432/urbanfleet_ride?schema=public',
  },
});

