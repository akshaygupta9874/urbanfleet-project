import { UserRepository } from '../repositories/user.repository.js';
import { NotFoundError } from '@urbanfleet/common';

export class UserService {
  constructor(private userRepo: UserRepository) {}

  async getUserById(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError('User not found');
    const { passwordHash, twoFactorSecret, ...safeUser } = user;
    return safeUser;
  }

  async getUserByEmail(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User not found');
    const { passwordHash, twoFactorSecret, ...safeUser } = user;
    return safeUser;
  }

  async updateUser(id: string, data: { fullName?: string; phone?: string; avatarUrl?: string }) {
    const updated = await this.userRepo.update(id, data);
    const { passwordHash, twoFactorSecret, ...safeUser } = updated;
    return safeUser;
  }

  async deleteUser(id: string) {
    await this.userRepo.delete(id);
    return { success: true };
  }
}
