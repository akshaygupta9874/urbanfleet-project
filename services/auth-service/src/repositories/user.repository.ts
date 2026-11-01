import { PrismaClient, User, Role } from '../db/client.js';
import { NotFoundError } from '@urbanfleet/common';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roles?: Role[];
  avatarUrl?: string;
  isEmailVerified?: boolean;
}

export class UserRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async addDriverRole(id: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const roles = Array.from(new Set([...user.roles, Role.DRIVER]));
      return tx.user.update({ where: { id }, data: { roles } });
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }

  async list(params: { page: number; limit: number; search?: string; role?: Role }) {
    const where = {
      ...(params.search
        ? {
            OR: [
              { email: { contains: params.search, mode: 'insensitive' as const } },
              { firstName: { contains: params.search, mode: 'insensitive' as const } },
              { lastName: { contains: params.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(params.role ? { roles: { has: params.role } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          roles: true,
          isEmailVerified: true,
          isSuspended: true,
          suspendedAt: true,
          suspensionReason: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  async setSuspension(id: string, suspended: boolean, reason?: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        isSuspended: suspended,
        suspendedAt: suspended ? new Date() : null,
        suspensionReason: suspended ? reason : null,
      },
    });
  }
}
