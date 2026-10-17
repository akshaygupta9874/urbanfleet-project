import 'dotenv/config';
import { definePrismaConfig, env } from '@urbanfleet/common';

/**
 * DRIVER-SERVICE - Prisma Configuration
 * Decouples runtime connection options and migration definitions from schema.prisma.
 */
export default definePrismaConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env(
      'DATABASE_URL',
      'postgresql://driver_user:driver_secure_pass@localhost:5432/urbanfleet_driver?schema=public'
    ),
  },
  seed: 'tsx prisma/seed.ts',
  client: {
    log: env('NODE_ENV') === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'pretty',
  },
});
