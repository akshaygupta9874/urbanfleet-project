import { PrismaClient, Payout, Prisma } from '../db/client.js';

export class PayoutRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: Prisma.PayoutCreateInput, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payout> {
    const client = tx || this.prisma;
    return client.payout.create({ data });
  }

  async findByDriverId(driverId: string): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
  }

  async update(id: string, data: Prisma.PayoutUpdateInput, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payout> {
    const client = tx || this.prisma;
    return client.payout.update({ where: { id }, data });
  }

  async executeTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn as unknown as Parameters<typeof this.prisma.$transaction>[0]) as Promise<T>;
  }
}
