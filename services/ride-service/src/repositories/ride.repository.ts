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
      include: { ratings: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
  }

  async findHistoryByDriverId(driverId: string): Promise<Ride[]> {
    return this.prisma.ride.findMany({
      where: { driverId },
      include: { ratings: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
  }

  async getDriverRideAggregates(driverId: string) {
    const [completedStats, cancelledTrips, totalTrips] = await Promise.all([
      this.prisma.ride.aggregate({
        where: {
          driverId,
          status: 'COMPLETED',
        },
        _sum: {
          distanceKm: true,
          totalFarePaise: true,
        },
        _count: true,
      }),
      this.prisma.ride.count({
        where: {
          driverId,
          status: 'CANCELLED',
        },
      }),
      this.prisma.ride.count({
        where: {
          driverId,
        },
      }),
    ]);

    const completedTrips = completedStats._count || 0;
    const totalDistanceKm = Number(completedStats._sum.distanceKm || 0);
    const totalFarePaise = Number(completedStats._sum.totalFarePaise || 0);
    const totalEarningsPaise = Math.round(totalFarePaise * 0.8);

    return {
      totalTrips,
      completedTrips,
      cancelledTrips,
      totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
      totalDistanceMeters: Math.round(totalDistanceKm * 1000),
      totalFarePaise,
      totalEarningsPaise,
    };
  }

  async findRatingsForDriver(driverId: string) {
    return this.prisma.rating.findMany({
      where: {
        OR: [
          { toId: driverId },
          { ride: { driverId } },
        ],
      },
      include: {
        ride: {
          select: {
            id: true,
            pickupAddress: true,
            destinationAddress: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
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
