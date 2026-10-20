import { PrismaClient, Payment, Prisma } from '../db/client.js';

export class PaymentRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findUnique({ where: { id }, include: { refundRecords: true, payouts: true } });
  }

  async findByRideId(rideId: string, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findUnique({ where: { rideId }, include: { refundRecords: true, payouts: true } });
  }

  async findByGatewayOrderId(gatewayOrderId: string, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findFirst({ where: { gatewayOrderId } });
  }

  async create(data: Prisma.PaymentCreateInput, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payment> {
    const client = tx || this.prisma;
    return client.payment.create({ data });
  }

  async update(id: string, data: Prisma.PaymentUpdateInput, tx?: Prisma.TransactionClient | PrismaClient): Promise<Payment> {
    const client = tx || this.prisma;
    return client.payment.update({ where: { id }, data });
  }

  async executeTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn as unknown as Parameters<typeof this.prisma.$transaction>[0]) as Promise<T>;
  }
}
