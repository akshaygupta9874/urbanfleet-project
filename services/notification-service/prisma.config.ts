import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/**
 * NOTIFICATION-SERVICE - Dedicated Prisma Configuration
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
      'postgresql://notification_user:notification_secure_pass@localhost:5432/urbanfleet_notification?schema=public',
  },
});

