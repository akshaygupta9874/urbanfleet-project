import { PrismaClient, Session, Prisma } from '../db/client.js';

export interface CreateSessionData {
  userId: string;
  version: number;
  userAgent: string;
  ipAddress: string;
  deviceType: string;
  browser: string;
  os: string;
  expiresAt: Date;
}

export interface ListSessionsParams {
  page: number;
  limit: number;
  userId?: string;
}

export interface SessionListItem {
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface ListSessionsResult {
  items: SessionListItem[];
  total: number;
}

export class SessionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: CreateSessionData): Promise<Session> {
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

  async deleteByIdAndUserId(id: string, userId: string): Promise<{ count: number }> {
    return this.prisma.session.deleteMany({
      where: { id, userId },
    });
  }

  async deleteByUserId(userId: string, exceptSessionId?: string): Promise<{ count: number }> {
    return this.prisma.session.deleteMany({
      where: {
        userId,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
    });
  }

  async deleteExpired(): Promise<{ count: number }> {
    return this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  async list(params: ListSessionsParams): Promise<ListSessionsResult> {
    const { page, limit, userId } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.SessionWhereInput = {};
    if (userId) {
      where.userId = userId;
    }

    const [items, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lastActiveAt: 'desc' },
        select: {
          id: true,
          userId: true,
          userAgent: true,
          ipAddress: true,
          deviceType: true,
          browser: true,
          os: true,
          lastActiveAt: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.session.count({ where }),
    ]);

    return { items, total };
  }
}
