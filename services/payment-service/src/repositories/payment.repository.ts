import { PrismaClient, Payment } from '@prisma/client';

export class PaymentRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string, tx?: any): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findUnique({ where: { id }, include: { refundRecords: true, payouts: true } });
  }

  async findByRideId(rideId: string, tx?: any): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findUnique({ where: { rideId }, include: { refundRecords: true, payouts: true } });
  }

  async findByGatewayOrderId(gatewayOrderId: string, tx?: any): Promise<Payment | null> {
    const client = tx || this.prisma;
    return client.payment.findFirst({ where: { gatewayOrderId } });
  }

  async create(data: any, tx?: any): Promise<Payment> {
    const client = tx || this.prisma;
    return client.payment.create({ data });
  }

  async update(id: string, data: any, tx?: any): Promise<Payment> {
    const client = tx || this.prisma;
    return client.payment.update({ where: { id }, data });
  }

  async executeTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
