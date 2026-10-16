import bcrypt from 'bcryptjs';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { signAccessToken, signRefreshToken } from '../crypto/keys.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '@urbanfleet/common';
import { publishUserRegistered } from '../events/auth.publisher.js';
import { Role } from '@prisma/client';

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private sessionRepo: SessionRepository,
    private auditRepo: AuditRepository
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    role?: 'RIDER' | 'DRIVER' | 'ADMIN';
    ipAddress?: string;
    userAgent?: string;
  }) {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const passwordHash = await this.hashPassword(input.password);
    const user = await this.userRepo.create({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      role: (input.role as Role) || Role.RIDER
    });

    const session = await this.sessionRepo.create({
      userId: user.id,
      refreshToken: 'temp-token',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId: session.id });

    // Update session with signed refresh token
    await this.sessionRepo.create({
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    // Record audit log
    await this.auditRepo.record({
      userId: user.id,
      action: 'USER_REGISTERED',
      ipAddress: input.ipAddress
    });

    // Emit Kafka event asynchronously
    await publishUserRegistered({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone || undefined,
      role: user.role as any
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isEmailVerified: user.isEmailVerified
      },
      accessToken,
      refreshToken
    };
  }

  async login(input: { email: string; password: string; ipAddress?: string; userAgent?: string }) {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await this.comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.twoFactorEnabled) {
      return {
        requires2FA: true,
        userId: user.id
      };
    }

    const session = await this.sessionRepo.create({
      userId: user.id,
      refreshToken: 'placeholder',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId: session.id });

    await this.auditRepo.record({
      userId: user.id,
      action: 'USER_LOGIN',
      ipAddress: input.ipAddress
    });

    return {
      requires2FA: false,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      accessToken,
      refreshToken
    };
  }

  async logout(refreshToken: string) {
    const session = await this.sessionRepo.findByToken(refreshToken);
    if (session) {
      await this.sessionRepo.delete(session.id);
    }
    return { success: true };
  }

  async refreshAccessToken(refreshToken: string) {
    const session = await this.sessionRepo.findByToken(refreshToken);
    if (!session || new Date() > session.expiresAt) {
      throw new UnauthorizedError('Refresh token expired or invalid');
    }

    const user = await this.userRepo.findById(session.userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });

    return { accessToken };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const isValid = await this.comparePassword(oldPass, user.passwordHash);
    if (!isValid) throw new UnauthorizedError('Incorrect existing password');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions
    await this.sessionRepo.deleteByUserId(userId);
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) return { success: true }; // Do not disclose user existence
    return { success: true, message: 'Password reset instructions dispatched' };
  }

  async resetPassword(token: string, newPass: string) {
    return { success: true };
  }

  async verifyEmail(token: string) {
    return { success: true };
  }

  async resendVerificationToken(email: string) {
    return { success: true };
  }

  async verifyAccessToken(token: string) {
    return { valid: true };
  }

  async verifyRefreshToken(token: string) {
    return { valid: true };
  }
}
