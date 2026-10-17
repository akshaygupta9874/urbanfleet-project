import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../crypto/keys.js';
import { ConflictError, UnauthorizedError, NotFoundError, createLogger } from '@urbanfleet/common';
import { publishUserRegistered } from '../events/auth.publisher.js';
import { Role } from '@prisma/client';
import { cacheTokens, revokeCachedTokens } from '../redis/token-cache.js';
import { authRedisClient, authRedisKey } from '../redis/client.js';

const logger = createLogger('auth-service');

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

    // Cache tokens in Redis for fast access
    await cacheTokens(user.id, session.id, accessToken, refreshToken);

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

    // Cache tokens in Redis for fast access
    await cacheTokens(user.id, session.id, accessToken, refreshToken);

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
      await revokeCachedTokens(session.userId, session.id);
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

    const newRefreshToken = signRefreshToken({ userId: user.id, sessionId: session.id });

    await this.sessionRepo.create({
      userId: user.id,
      refreshToken: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: session.ipAddress || undefined,
      userAgent: session.userAgent || undefined
    });
    await this.sessionRepo.delete(session.id);

    // Cache updated tokens in Redis for fast access
    await cacheTokens(user.id, session.id, accessToken, newRefreshToken);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, role: user.role }
    };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const isValid = await this.comparePassword(oldPass, user.passwordHash);
    if (!isValid) throw new UnauthorizedError('Incorrect existing password');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions and cached tokens
    await this.sessionRepo.deleteByUserId(userId);
    await revokeCachedTokens(userId);
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      return { success: true, message: 'If that email is registered, reset instructions have been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.set(authRedisKey(`reset:${resetToken}`), user.id, { EX: 900 });
      }
    } catch (err) {
      logger.error('Failed to cache reset token in Redis:', err);
    }

    return {
      success: true,
      message: 'Password reset instructions dispatched',
      ...(process.env.NODE_ENV !== 'production' ? { resetToken } : {})
    };
  }

  async resetPassword(token: string, newPass: string) {
    if (!token) throw new UnauthorizedError('Reset token is required');

    let userId: string | null = null;
    try {
      if (authRedisClient.isOpen) {
        userId = await authRedisClient.get(authRedisKey(`reset:${token}`));
      }
    } catch (err) {
      logger.error('Failed to retrieve reset token from Redis:', err);
    }

    if (!userId) {
      throw new UnauthorizedError('Reset token is invalid or has expired');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions and cached tokens
    await this.sessionRepo.deleteByUserId(userId);
    await revokeCachedTokens(userId);

    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`reset:${token}`));
      }
    } catch (err) {
      logger.error('Failed to clean up reset token:', err);
    }

    return { success: true, message: 'Password has been successfully updated' };
  }

  async verifyEmail(token: string) {
    if (!token) throw new UnauthorizedError('Verification token is required');

    let userIdOrData: string | null = null;
    try {
      if (authRedisClient.isOpen) {
        userIdOrData = await authRedisClient.get(authRedisKey(`verify:${token}`));
      }
    } catch (err) {
      logger.error('Failed to retrieve verification token from Redis:', err);
    }

    if (!userIdOrData) {
      throw new UnauthorizedError('Verification token is invalid or has expired');
    }

    let userId = userIdOrData;
    try {
      const parsed = JSON.parse(userIdOrData);
      if (parsed.userId || parsed.id) userId = parsed.userId || parsed.id;
    } catch (_) {}

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User account not found');

    await this.userRepo.update(userId, { isEmailVerified: true });

    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`verify:${token}`));
      }
    } catch (err) {}

    return { success: true, message: 'Email verified successfully. Your account is active.' };
  }

  async resendVerificationToken(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User with this email was not found');
    if (user.isEmailVerified) throw new ConflictError('Email is already verified');

    const verifyToken = crypto.randomBytes(32).toString('hex');
    try {
      if (authRedisClient.isOpen) {
        await authRedisClient.set(authRedisKey(`verify:${verifyToken}`), user.id, { EX: 86400 });
      }
    } catch (err) {
      logger.error('Failed to store verification token in Redis:', err);
    }

    return {
      success: true,
      message: 'Verification link resent successfully',
      ...(process.env.NODE_ENV !== 'production' ? { verifyToken } : {})
    };
  }

  async verifyAccessToken(token: string) {
    try {
      const decoded = verifyToken(token);
      return { valid: true, payload: decoded };
    } catch (err: any) {
      throw new UnauthorizedError(`Invalid access token: ${err.message}`);
    }
  }

  async verifyRefreshToken(token: string) {
    try {
      const decoded = verifyToken(token);
      const session = await this.sessionRepo.findByToken(token);
      if (!session || new Date() > session.expiresAt) {
        throw new UnauthorizedError('Session has expired or was revoked');
      }
      return { valid: true, payload: decoded, session };
    } catch (err: any) {
      throw new UnauthorizedError(`Invalid refresh token: ${err.message}`);
    }
  }
}
