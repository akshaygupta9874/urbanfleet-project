import { PrismaClient, Ride, RideStatus } from '@prisma/client';

export class RideRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<Ride | null> {
    return this.prisma.ride.findUnique({ where: { id }, include: { ratings: true } });
  }

  async findActiveRide(riderId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        riderId,
        status: { in: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
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
}
