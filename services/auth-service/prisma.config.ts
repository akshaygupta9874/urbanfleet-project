import 'dotenv/config';
import { defineConfig } from '@prisma/config';

/**
 * AUTH-SERVICE - Dedicated Prisma Configuration
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
      'postgresql://auth_user:auth_secure_pass@localhost:5432/urbanfleet_auth?schema=public',
  },
});

