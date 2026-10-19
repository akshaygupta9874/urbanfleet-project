import { PrismaClient, Ride } from '../db/client.js';

export class RideRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string, tx?: any): Promise<Ride | null> {
    const client = tx || this.prisma;
    return client.ride.findUnique({ where: { id }, include: { ratings: true } });
  }

  async findActiveRide(riderId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        riderId,
        status: { in: ['REQUESTED', 'SEARCHING', 'OFFERED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'STARTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED_AT_DESTINATION'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findActiveRideByDriverId(driverId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: ['ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_PROGRESS', 'STARTED', 'ARRIVED_AT_DESTINATION'] }
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

  async create(data: any, tx?: any): Promise<Ride> {
    const client = tx || this.prisma;
    return client.ride.create({ data });
  }

  async update(id: string, data: any, tx?: any): Promise<Ride> {
    const client = tx || this.prisma;
    return client.ride.update({ where: { id }, data });
  }

  async findActiveRideByRiderId(riderId: string): Promise<Ride | null> {
    return this.findActiveRide(riderId);
  }

  async executeTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
