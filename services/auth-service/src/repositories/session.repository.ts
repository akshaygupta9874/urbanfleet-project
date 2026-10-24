import { PrismaClient, Session } from '../db/client.js';

export class SessionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: {
    id?: string;
    userId: string;
    version?: number;
    userAgent?: string;
    ipAddress?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    lastActiveAt?: Date;
    expiresAt: Date;
  }): Promise<Session> {
    return this.prisma.session.create({ data });
  }

  async findById(id: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async updateVersion(id: string, version: number): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: {
        version,
        lastActiveAt: new Date(),
      },
    });
  }

  async delete(id: string): Promise<Session> {
    return this.prisma.session.delete({ where: { id } });
  }

  async deleteByUserId(userId: string, exceptSessionId?: string): Promise<{ count: number }> {
    return this.prisma.session.deleteMany({
      where: {
        userId,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
    });
  }

  /**
   * Deprecated backward compatibility helper
   */
  async findByToken(_refreshToken: string): Promise<Session | null> {
    return null;
  }
}
