import { PrismaClient, Refund } from '@prisma/client';

export class RefundRepository {
  constructor(private prisma: PrismaClient) {}

  async create(tx: any, data: any): Promise<Refund> {
    return tx.refund.create({ data });
  }

  async findByPaymentId(paymentId: string): Promise<Refund[]> {
    return this.prisma.refund.findMany({ where: { paymentId } });
  }
}
