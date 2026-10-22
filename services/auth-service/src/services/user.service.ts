import { UserRepository } from '../repositories/user.repository.js';
import { NotFoundError } from '@urbanfleet/common';
import { User } from '../db/client.js';
import { cacheUser } from '../redis/token-cache.js';

function sanitizeUser(user: User) {
  const {
    passwordHash,
    ...safeUser
  } = user;
  return {
    ...safeUser,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export class UserService {
  private userRepo: UserRepository;

  constructor(userRepo: UserRepository) {
    this.userRepo = userRepo;
  }

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

  async updateUser(id: string, data: { firstName?: string; lastName?: string; avatarUrl?: string }) {
    const updated = await this.userRepo.update(id, data);
    return sanitizeUser(updated);
  }

  async addDriverRole(id: string) {
    const user = await this.userRepo.addDriverRole(id);
    await cacheUser({
      id: user.id,
      email: user.email,
      roles: user.roles,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    return sanitizeUser(user);
  }

  async deleteUser(id: string) {
    await this.userRepo.delete(id);
    return { success: true };
  }
}
