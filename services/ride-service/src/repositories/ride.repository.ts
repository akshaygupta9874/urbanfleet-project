import { PrismaClient, Ride, Prisma } from '../db/client.js';

export class RideRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<Ride | null> {
    const client = tx || this.prisma;
    return client.ride.findUnique({ where: { id }, include: { ratings: true } });
  }

  async findActiveRide(riderId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        riderId,
        status: { in: ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'RIDE_STARTED', 'ARRIVED_AT_DESTINATION'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findActiveRideByDriverId(driverId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'RIDE_STARTED', 'ARRIVED_AT_DESTINATION'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findHistoryByRiderId(riderId: string): Promise<Ride[]> {
    return this.prisma.ride.findMany({
      where: { riderId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  async findHistoryByDriverId(driverId: string): Promise<Ride[]> {
    return this.prisma.ride.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  async create(data: Prisma.RideCreateInput, tx?: Prisma.TransactionClient): Promise<Ride> {
    const client = tx || this.prisma;
    return client.ride.create({ data });
  }

  async update(id: string, data: Prisma.RideUpdateInput, tx?: Prisma.TransactionClient): Promise<Ride> {
    const client = tx || this.prisma;
    return client.ride.update({ where: { id }, data });
  }

  async findActiveRideByRiderId(riderId: string): Promise<Ride | null> {
    return this.findActiveRide(riderId);
  }

  async executeTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
