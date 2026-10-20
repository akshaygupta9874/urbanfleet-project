import { PrismaClient, Refund, Prisma } from '../db/client.js';

export class RefundRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(tx: Prisma.TransactionClient | PrismaClient, data: Prisma.RefundUncheckedCreateInput | Prisma.RefundCreateInput): Promise<Refund> {
    const client = tx || this.prisma;
    return client.refund.create({ data: data as Prisma.RefundCreateInput });
  }

  async findByPaymentId(paymentId: string): Promise<Refund[]> {
    return this.prisma.refund.findMany({ where: { paymentId } });
  }
}
