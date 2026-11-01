import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { NotFoundError } from '@urbanfleet/common';
import { User } from '../db/client.js';
import { cacheUser, revokeCachedTokens } from '../redis/token-cache.js';

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
  private sessionRepo?: SessionRepository;

  constructor(userRepo: UserRepository, sessionRepo?: SessionRepository) {
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
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

  async listUsers(params: { page: number; limit: number; search?: string; role?: 'RIDER' | 'DRIVER' | 'ADMIN' }) {
    return this.userRepo.list(params as Parameters<UserRepository['list']>[0]);
  }

  async setSuspension(id: string, suspended: boolean, reason?: string) {
    const updated = await this.userRepo.setSuspension(id, suspended, reason);
    if (suspended) {
      if (this.sessionRepo) {
        await this.sessionRepo.deleteByUserId(id).catch(() => {});
      }
      await revokeCachedTokens(id).catch(() => {});
    }
    await cacheUser({
      id: updated.id,
      email: updated.email,
      roles: updated.roles,
      firstName: updated.firstName,
      lastName: updated.lastName,
      isSuspended: updated.isSuspended,
    });
    return sanitizeUser(updated);
  }
}
