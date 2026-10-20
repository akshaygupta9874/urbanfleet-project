import { PrismaClient, Payout } from '../db/client.js';

export class PayoutRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: any, tx?: any): Promise<Payout> {
    const client = tx || this.prisma;
    return client.payout.create({ data });
  }

  async findByDriverId(driverId: string): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
  }

  async update(id: string, data: any, tx?: any): Promise<Payout> {
    const client = tx || this.prisma;
    return client.payout.update({ where: { id }, data });
  }

  async executeTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
