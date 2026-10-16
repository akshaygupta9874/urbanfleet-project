import { PrismaClient, Payout } from '@prisma/client';

export class PayoutRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: any): Promise<Payout> {
    return this.prisma.payout.create({ data });
  }

  async findByDriverId(driverId: string): Promise<Payout[]> {
    return this.prisma.payout.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
  }

  async update(id: string, data: any): Promise<Payout> {
    return this.prisma.payout.update({ where: { id }, data });
  }
}
