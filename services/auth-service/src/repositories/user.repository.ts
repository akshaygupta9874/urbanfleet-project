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

      const roles = Array.from(new Set([
        Role.RIDER,
        ...user.roles.filter((role) => role !== Role.RIDER && role !== Role.DRIVER),
        Role.DRIVER,
      ]));
      return tx.user.update({ where: { id }, data: { roles } });
    });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }
}
