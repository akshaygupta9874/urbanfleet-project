import { PrismaClient, User, Role } from '../db/client.js';

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: Role;
    avatarUrl?: string;
    isEmailVerified?: boolean;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }

  async consumeRecoveryCode(
    userId: string,
    codeHash: string
  ): Promise<{ success: boolean; user: User; remainingCount: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || !user.twoFactorRecoveryCodes) {
        return null;
      }

      let hashedCodes: string[] = [];
      try {
        hashedCodes = JSON.parse(user.twoFactorRecoveryCodes);
      } catch {
        return null;
      }

      const matchedIndex = hashedCodes.indexOf(codeHash);
      if (matchedIndex === -1) {
        return null;
      }

      hashedCodes.splice(matchedIndex, 1);
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorRecoveryCodes: JSON.stringify(hashedCodes),
        },
      });

      return {
        success: true,
        user: updatedUser,
        remainingCount: hashedCodes.length,
      };
    });
  }
}
