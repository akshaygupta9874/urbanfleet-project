import type { Prisma, PrismaClient } from '../db/client.js';

export type DbClient = Prisma.TransactionClient | PrismaClient;
export type ClientSession = DbClient | { tx?: Prisma.TransactionClient | PrismaClient };
