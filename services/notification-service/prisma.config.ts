import 'dotenv/config';

/**
 * NOTIFICATION-SERVICE - Dedicated Prisma Configuration
 * Completely standalone configuration decoupled from shared packages.
 */
export default {
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://notification_user:notification_secure_pass@localhost:5432/urbanfleet_notification?schema=public',
  },
  seed: 'tsx prisma/seed.ts',
  client: {
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'pretty',
  },
};
