import { PrismaClient, Ride, Rating, RideStatus, RidePaymentStatus, Prisma } from '../db/client.js';

export interface ListRidesParams {
  page?: number;
  limit?: number;
  status?: RideStatus;
  paymentStatus?: RidePaymentStatus;
  search?: string;
}

export interface ListRidesResult {
  items: Array<Ride & { ratings: Rating[] }>;
  total: number;
}

export interface RideAnalyticsResult {
  period: string;
  totalRides: number;
  completedRides: number;
  totalFarePaise: number;
  statusBreakdown: Record<string, number>;
}

export class RideRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<(Ride & { ratings: Rating[] }) | null> {
    const client = tx || this.prisma;
    return client.ride.findUnique({ where: { id }, include: { ratings: true } });
  }

  async findActiveRide(riderId: string): Promise<Ride | null> {
    return this.prisma.ride.findFirst({
      where: {
        riderId,
        status: { in: ['SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'RIDE_STARTED', 'ARRIVED_AT_DESTINATION'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveRideByDriverId(driverId: string | string[]): Promise<Ride | null> {
    const driverFilter = Array.isArray(driverId) ? { in: driverId } : driverId;
    return this.prisma.ride.findFirst({
      where: {
        driverId: driverFilter,
        status: { in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'RIDE_STARTED', 'ARRIVED_AT_DESTINATION'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findHistoryByRiderId(riderId: string): Promise<Array<Ride & { ratings: Rating[] }>> {
    return this.prisma.ride.findMany({
      where: { riderId },
      include: { ratings: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async findHistoryByDriverId(driverId: string | string[]): Promise<Array<Ride & { ratings: Rating[] }>> {
    const driverFilter = Array.isArray(driverId) ? { in: driverId } : driverId;
    return this.prisma.ride.findMany({
      where: { driverId: driverFilter },
      include: { ratings: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async list(params: ListRidesParams = {}): Promise<ListRidesResult> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.RideWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.paymentStatus) {
      where.paymentStatus = params.paymentStatus;
    }

    if (params.search && params.search.trim().length > 0) {
      const search = params.search.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      where.OR = [
        { pickupAddress: { contains: search, mode: 'insensitive' } },
        { destinationAddress: { contains: search, mode: 'insensitive' } },
        ...(isUuid ? [{ id: search }, { riderId: search }, { driverId: search }] : []),
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        include: { ratings: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ride.count({ where }),
    ]);

    return { items, total };
  }

  async getAnalytics(period = 'today'): Promise<RideAnalyticsResult> {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === 'month') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (period === 'all') startDate = new Date(0);

    const [statusCounts, completedStats, totalCount] = await Promise.all([
      this.prisma.ride.groupBy({
        by: ['status'],
        _count: true,
        where: { createdAt: { gte: startDate } },
      }),
      this.prisma.ride.aggregate({
        _sum: { totalFarePaise: true },
        _count: true,
        where: { status: 'COMPLETED', createdAt: { gte: startDate } },
      }),
      this.prisma.ride.count({ where: { createdAt: { gte: startDate } } }),
    ]);

    const breakdown: Record<string, number> = {
      SEARCHING: 0,
      DRIVER_ASSIGNED: 0,
      DRIVER_ARRIVING: 0,
      RIDE_STARTED: 0,
      ARRIVED_AT_DESTINATION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };

    for (const item of statusCounts) {
      breakdown[item.status] = item._count;
    }

    return {
      period,
      totalRides: totalCount,
      completedRides: completedStats._count,
      totalFarePaise: completedStats._sum.totalFarePaise || 0,
      statusBreakdown: breakdown,
    };
  }

  async getDriverRideAggregates(driverId: string | string[]) {
    const driverFilter = Array.isArray(driverId) ? { in: driverId } : driverId;
    const [completedStats, cancelledTrips, totalTrips] = await Promise.all([
      this.prisma.ride.aggregate({
        where: {
          driverId: driverFilter,
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
          driverId: driverFilter,
          status: 'CANCELLED',
        },
      }),
      this.prisma.ride.count({
        where: {
          driverId: driverFilter,
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

  async findRatingsForDriver(driverId: string | string[]) {
    const ids = Array.isArray(driverId) ? driverId : [driverId];
    return this.prisma.rating.findMany({
      where: {
        OR: [
          { toId: { in: ids } },
          { ride: { driverId: { in: ids } } },
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
