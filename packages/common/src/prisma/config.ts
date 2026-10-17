export interface PrismaDatasourceConfig {
  url?: string;
  shadowDatabaseUrl?: string;
  provider?: string;
  directUrl?: string;
}

export interface PrismaMigrationsConfig {
  path?: string;
  seed?: string;
}

export interface PrismaClientOptions {
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
  errorFormat?: 'pretty' | 'colorless' | 'minimal';
}

export interface PrismaConfig {
  schema?: string;
  migrations?: PrismaMigrationsConfig;
  datasource?: PrismaDatasourceConfig;
  seed?: string;
  client?: PrismaClientOptions;
  [key: string]: unknown;
}

/**
 * Type-safe configuration helper for Prisma ORM (Prisma 5 / 6 / 7 compatible).
 */
export function defineConfig(config: PrismaConfig): PrismaConfig {
  return config;
}

export function definePrismaConfig(config: PrismaConfig): PrismaConfig {
  return config;
}

/**
 * Safe environment variable reader with fallback default.
 */
export function env(name: string, fallback?: string): string {
  const val = process.env[name];
  if (val !== undefined && val !== '') {
    return val;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return '';
}
