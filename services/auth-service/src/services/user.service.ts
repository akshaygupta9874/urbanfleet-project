import { UserRepository } from '../repositories/user.repository.js';
import { NotFoundError } from '@urbanfleet/common';

function sanitizeUser(user: any) {
  const {
    passwordHash,
    twoFactorSecret,
    twoFactorPendingSecret,
    twoFactorRecoveryCodes,
    twoFactorSetupRequestedAt,
    ...safeUser
  } = user;
  return {
    ...safeUser,
    firstName: user.firstName || 'User',
    lastName: user.lastName || '',
  };
}

export class UserService {
  constructor(private userRepo: UserRepository) {}

  async getUserById(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return sanitizeUser(user);
  }

  async getUserByEmail(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User not found');
    return sanitizeUser(user);
  }

  async updateUser(id: string, data: { firstName?: string; lastName?: string; phone?: string; avatarUrl?: string }) {
    const updated = await this.userRepo.update(id, data);
    return sanitizeUser(updated);
  }

  async deleteUser(id: string) {
    await this.userRepo.delete(id);
    return { success: true };
  }
}
