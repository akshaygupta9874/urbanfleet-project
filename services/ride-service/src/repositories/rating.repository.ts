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
}
