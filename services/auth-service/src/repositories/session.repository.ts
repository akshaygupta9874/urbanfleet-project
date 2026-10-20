import { PrismaClient, Session } from '../db/client.js';

export class SessionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: {
    id?: string;
    userId: string;
    refreshToken: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  async findByToken(refreshToken: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { refreshToken } });
  }

  async delete(id: string): Promise<Session> {
    return this.prisma.session.delete({ where: { id } });
  }

  async deleteByUserId(userId: string): Promise<{ count: number }> {
    return this.prisma.session.deleteMany({ where: { userId } });
  }
}
