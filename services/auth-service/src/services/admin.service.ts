import { UserRepository } from '../repositories/user.repository.js';

export class AdminService {
  private userRepo: UserRepository;

  constructor(userRepo: UserRepository) {
    this.userRepo = userRepo;
  }

  async getSystemStats() {
    const totalUsers = await this.userRepo.count();
    return {
      totalUsers,
      systemStatus: 'HEALTHY',
      timestamp: new Date().toISOString()
    };
  }

  async listUsers(page = 1, limit = 20) {
    return { users: [], page, limit };
  }
}
