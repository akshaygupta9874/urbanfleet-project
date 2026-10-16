import { PrismaClient, Payment } from '@prisma/client';

export class PaymentRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { id }, include: { refunds: true, payouts: true } });
  }

  async findByRideId(rideId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { rideId }, include: { refunds: true, payouts: true } });
  }

  async findByGatewayOrderId(gatewayOrderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({ where: { gatewayOrderId } });
  }

  async create(data: any): Promise<Payment> {
    return this.prisma.payment.create({ data });
  }

  async update(id: string, data: any): Promise<Payment> {
    return this.prisma.payment.update({ where: { id }, data });
  }
}
