import { PrismaClient, Rating } from '@prisma/client';

export class RatingRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    rideId: string;
    fromId: string;
    toId: string;
    score: number;
    feedback?: string;
  }): Promise<Rating> {
    return this.prisma.rating.create({ data });
  }

  async findByRideAndFrom(rideId: string, fromId: string): Promise<Rating | null> {
    return this.prisma.rating.findUnique({
      where: {
        rideId_fromId: {
          rideId,
          fromId,
        },
      },
    });
  }
}
