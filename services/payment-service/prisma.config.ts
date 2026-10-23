import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/**
 * PAYMENT-SERVICE - Dedicated Prisma Configuration
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
      process.env.DIRECT_DATABASE_URL ||
      process.env.DATABASE_URL ||
      'postgresql://payment_user:payment_secure_pass@localhost:5432/urbanfleet_payment?schema=public',
  },
});

