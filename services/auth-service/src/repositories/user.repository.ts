import { PrismaClient, User, Role, Prisma } from '../db/client.js';
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

export interface ListUsersParams {
  page: number;
  limit: number;
  search?: string;
  role?: Role;
}

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  isEmailVerified: boolean;
  isSuspended: boolean;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { sessions: number };
}

export interface ListUsersResult {
  items: UserListItem[];
  total: number;
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

  async create(data: CreateUserData, tx?: Prisma.TransactionClient): Promise<User> {
    const client = tx || this.prisma;
    return client.user.create({ data });
  }

  async executeTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
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

  async list(params: ListUsersParams): Promise<ListUsersResult> {
    const { page, limit, search, role } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.roles = { has: role };
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
