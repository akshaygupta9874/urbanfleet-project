import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios, { isAxiosError } from 'axios';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { AuditRepository } from '../repositories/audit.repository.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../crypto/keys.js';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError, ForbiddenError, createLogger, ServiceUnavailableError, InternalServerError } from '@urbanfleet/common';
import { Role } from '../db/client.js';
import { cacheTokens, revokeCachedTokens, cacheUser } from '../redis/token-cache.js';
import { authRedisClient, authRedisKey } from '../redis/client.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { EventTopics } from '@urbanfleet/contracts';
import {
  publishUserRegistered,
  publishPasswordResetRequested,
  publishEmailVerificationRequested,
  publishLoginOtpRequested,
} from '../events/auth.publisher.js';

const logger = createLogger('auth-service');

export class AuthService {
  private userRepo: UserRepository;
  private sessionRepo: SessionRepository;
  private auditRepo: AuditRepository;
  private outboxRepo?: OutboxRepository;

  constructor(
    userRepo: UserRepository,
    sessionRepo: SessionRepository,
    auditRepo: AuditRepository,
    outboxRepo?: OutboxRepository
  ) {
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
    this.auditRepo = auditRepo;
    this.outboxRepo = outboxRepo;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roles?: Array<Role | 'RIDER' | 'DRIVER' | 'ADMIN'>;
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
      firstName: input.firstName,
      lastName: input.lastName,
      roles: input.roles,
      isEmailVerified: false,
    });

    // Registration creates an unverified account. Tokens and sessions are only issued after email verification upon login.

    // Audit logging
    try {
      await this.auditRepo.record({
        userId: user.id,
        action: 'USER_REGISTERED',
        ipAddress: input.ipAddress
      });
    } catch (err: unknown) {
      logger.warn('Failed to record audit log on registration:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    // Generate email verification token (24-hour expiration)
    const verifyToken = crypto.randomBytes(32).toString('hex');
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Verification service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      await authRedisClient.set(authRedisKey(`verify:${verifyToken}`), user.id, { EX: 86400 });
    } catch (err: unknown) {
      logger.error('Failed to store verification token in Redis during registration:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new ServiceUnavailableError(
        'Registration is temporarily unavailable. Please try again shortly.',
        'AUTH_REDIS_UNAVAILABLE',
        err instanceof Error ? err : undefined,
      );
    }

    const registrationEventId = crypto.randomUUID();

    // Durable Outbox event staging (blocking guarantee for event-driven consistency)
    if (this.outboxRepo) {
      try {
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_REGISTERED',
          aggregateType: 'USER',
          aggregateId: user.id,
          aggregateSequence: 1,
          payload: {
            id: registrationEventId,
            version: 1,
            eventType: 'USER_REGISTERED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            payload: {
              userId: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              roles: user.roles,
              verifyToken,
            },
          },
        });

        // Stage email verification requested event for notification-service
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
          aggregateType: 'USER',
          aggregateId: user.id,
          aggregateSequence: 2,
          payload: {
            id: crypto.randomUUID(),
            version: 1,
            eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            payload: {
              userId: user.id,
              email: user.email,
              verifyToken,
            },
          },
        });
      } catch (err: unknown) {
        logger.error('Failed to stage outbox event for registration:', {
          error: err instanceof Error ? err.message : String(err),
          userId: user.id,
        });
        throw new ServiceUnavailableError(
          'Failed to queue registration confirmation. Please try again.',
          'OUTBOX_STAGE_FAILED',
          err instanceof Error ? err : undefined,
        );
      }
    }

    // Emit Kafka event asynchronously using matching event ID
    publishUserRegistered(
      {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
      },
      registrationEventId
    ).catch((err: unknown) => {
      logger.warn('Direct Kafka event publication failed on registration (Outbox will deliver):', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
        isEmailVerified: user.isEmailVerified
      },
      message: 'Registration successful. Please verify your email before logging in.',
      verifyToken
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

    if (!user.isEmailVerified) {
      throw new ForbiddenError('Please verify your email address before logging in');
    }

    // Generate 6-digit cryptographically secure OTP for login verification
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Cache login OTP in Redis with 5-minute TTL (blocking requirement: user must be able to verify)
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Verification service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      await Promise.all([
        authRedisClient.set(authRedisKey(`otp:login:${user.id}`), otp, { EX: 300 }),
        authRedisClient.set(authRedisKey(`otp:login:${user.email.toLowerCase()}`), otp, { EX: 300 }),
      ]);
    } catch (err: unknown) {
      logger.error('Failed to store login OTP in Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new ServiceUnavailableError(
        'Unable to generate login verification code. Please try again.',
        'REDIS_OTP_STORAGE_FAILED',
        err instanceof Error ? err : undefined,
      );
    }

    // Stage outbox event for OTP notification dispatch (blocking guarantee for email delivery)
    if (this.outboxRepo) {
      try {
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_LOGIN_OTP_REQUESTED',
          aggregateType: 'USER',
          aggregateId: user.id,
          aggregateSequence: 1,
          payload: {
            id: crypto.randomUUID(),
            version: 1,
            eventType: 'USER_LOGIN_OTP_REQUESTED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            payload: {
              userId: user.id,
              email: user.email,
              otp,
            },
          },
        });
      } catch (err: unknown) {
        logger.error('Failed to stage outbox event for login OTP:', {
          error: err instanceof Error ? err.message : String(err),
          userId: user.id,
        });
        throw new ServiceUnavailableError(
          'Failed to dispatch login verification code. Please try again.',
          'OUTBOX_STAGE_FAILED',
          err instanceof Error ? err : undefined,
        );
      }
    }

    // Publish Kafka event for fast email notification delivery
    publishLoginOtpRequested({
      userId: user.id,
      email: user.email,
      otp,
    }).catch((err: unknown) => {
      logger.warn('Direct Kafka event publication failed for login OTP (Outbox will deliver):', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    });

    return {
      requiresOtp: true,
      userId: user.id,
      email: user.email,
    };
  }

  async verifyLoginOtp(input: {
    email: string;
    userId?: string;
    otp: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    let user = null;
    if (input.userId) {
      user = await this.userRepo.findById(input.userId);
    } else if (input.email) {
      user = await this.userRepo.findByEmail(input.email.toLowerCase());
    }

    if (!user) {
      throw new UnauthorizedError('User account not found');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenError('Please verify your email address before logging in');
    }

    let isValid = false;
    const submittedOtp = input.otp.trim();

    // Verify OTP against Redis (blocking: distinguish between redis infrastructure outage vs invalid code)
    let storedOtp: string | null = null;
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Verification service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      storedOtp = await authRedisClient.get(authRedisKey(`otp:login:${user.id}`));
      if (!storedOtp && user.email) {
        storedOtp = await authRedisClient.get(authRedisKey(`otp:login:${user.email.toLowerCase()}`));
      }
      if (storedOtp && storedOtp === submittedOtp) {
        isValid = true;
      }
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      logger.error('Failed to retrieve OTP from Redis during verification:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new ServiceUnavailableError(
        'Unable to verify authentication code at this time. Please try again.',
        'REDIS_GET_FAILED',
        err instanceof Error ? err : undefined,
      );
    }

    if (!isValid) {
      throw new UnauthorizedError('Invalid or expired verification code');
    }

    // Invalidate consumed OTP keys
    try {
      if (authRedisClient && authRedisClient.isOpen) {
        await Promise.all([
          authRedisClient.del(authRedisKey(`otp:login:${user.id}`)),
          authRedisClient.del(authRedisKey(`otp:login:${user.email.toLowerCase()}`)),
        ]);
      }
    } catch (err: unknown) {
      logger.warn('Failed to delete consumed OTP from Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    const firstName = user.firstName || 'User';
    const lastName = user.lastName || '';

    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    let session;
    try {
      session = await this.sessionRepo.create({
        id: sessionId,
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent ? input.userAgent.slice(0, 1000) : undefined,
      });
    } catch (err: unknown) {
      logger.error('Failed to create session in database upon OTP verification:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new InternalServerError('Failed to establish user session. Please try logging in again.');
    }

    // Cache tokens in Redis (non-blocking performance layer)
    try {
      await cacheTokens(user.id, session.id, accessToken, refreshToken);
      await cacheUser({
        id: user.id,
        email: user.email,
        roles: user.roles,
        firstName: user.firstName,
        lastName: user.lastName,
      });
    } catch (err: unknown) {
      logger.warn('Failed to cache tokens in Redis on OTP login:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    // Record audit event
    try {
      await this.auditRepo.record({
        userId: user.id,
        action: 'USER_LOGIN',
        ipAddress: input.ipAddress,
      });
    } catch (err: unknown) {
      logger.warn('Failed to record audit log for login:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        roles: user.roles,
        isEmailVerified: user.isEmailVerified,
      },
      accessToken,
      refreshToken,
    };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return { success: true };
    try {
      const session = await this.sessionRepo.findByToken(refreshToken);
      if (session) {
        await this.sessionRepo.delete(session.id);
        await revokeCachedTokens(session.userId, session.id);
      }
    } catch (err: unknown) {
      logger.error('Error during logout:', {
        error: err instanceof Error ? err.message : String(err),
      });
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

    const firstName = user.firstName;
    const lastName = user.lastName;
    const newSessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId: newSessionId,
      tokenType: 'ACCESS',
    });

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      sessionId: newSessionId,
      tokenType: 'REFRESH',
    });

    // Delete old session and revoke its cache
    try {
      await this.sessionRepo.delete(session.id);
      await revokeCachedTokens(user.id, session.id);
    } catch (err: unknown) {
      logger.warn('Failed to delete old session during refresh token rotation:', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: session.id,
      });
    }

    // Create new session with matching newSessionId (blocking)
    try {
      await this.sessionRepo.create({
        id: newSessionId,
        userId: user.id,
        refreshToken: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: session.ipAddress || undefined,
        userAgent: session.userAgent || undefined
      });
    } catch (err: unknown) {
      logger.error('Failed to create rotated session in database:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new InternalServerError('Failed to rotate session. Please log in again.');
    }

    // Cache updated tokens in Redis
    try {
      await cacheTokens(user.id, newSessionId, accessToken, newRefreshToken);
    } catch (err: unknown) {
      logger.warn('Failed to cache rotated tokens in Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName,
        lastName,
        roles: user.roles,
        isEmailVerified: user.isEmailVerified,
      }
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
    try {
      await this.sessionRepo.deleteByUserId(userId);
      await revokeCachedTokens(userId);
    } catch (err: unknown) {
      logger.warn('Failed to revoke sessions after password change:', {
        error: err instanceof Error ? err.message : String(err),
        userId,
      });
    }

    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      return { success: true, message: 'If that email is registered, reset instructions have been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Password reset service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      await authRedisClient.set(authRedisKey(`reset:${resetToken}`), user.id, { EX: 900 });
    } catch (err: unknown) {
      logger.error('Failed to cache reset token in Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new ServiceUnavailableError(
        'Unable to process password reset request. Please try again.',
        'REDIS_ERROR',
        err instanceof Error ? err : undefined,
      );
    }

    // Durable Outbox event staging for password reset dispatch (blocking guarantee)
    if (this.outboxRepo) {
      try {
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_PASSWORD_RESET_REQUESTED',
          aggregateType: 'USER',
          aggregateId: user.id,
          aggregateSequence: 1,
          payload: {
            id: crypto.randomUUID(),
            version: 1,
            eventType: 'USER_PASSWORD_RESET_REQUESTED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            payload: {
              userId: user.id,
              email: user.email,
              resetToken,
            },
          },
        });
      } catch (err: unknown) {
        logger.error('Failed to stage outbox event for password reset:', {
          error: err instanceof Error ? err.message : String(err),
          userId: user.id,
        });
        throw new ServiceUnavailableError(
          'Failed to schedule password reset notification. Please try again.',
          'OUTBOX_STAGE_FAILED',
          err instanceof Error ? err : undefined,
        );
      }
    }

    // Publish notification event to Kafka for fast dispatch
    publishPasswordResetRequested({
      userId: user.id,
      email: user.email,
      resetToken,
    }).catch((err: unknown) => {
      logger.warn('Direct Kafka event publication failed for password reset (Outbox will deliver):', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    });

    return {
      success: true,
      message: 'Password reset instructions dispatched',
      resetToken,
    };
  }

  async forgotPassword(email: string) {
    return this.requestPasswordReset(email);
  }

  async resetPassword(token: string, newPass: string) {
    if (!token) throw new BadRequestError('Reset token is required');

    let userId: string | null = null;
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Password reset service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      userId = await authRedisClient.get(authRedisKey(`reset:${token}`));
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      logger.error('Failed to retrieve reset token from Redis:', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableError(
        'Unable to process password reset. Please try again.',
        'REDIS_ERROR',
        err instanceof Error ? err : undefined,
      );
    }

    if (!userId) {
      throw new UnauthorizedError('Reset token is invalid or has expired');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const passwordHash = await this.hashPassword(newPass);
    await this.userRepo.update(userId, { passwordHash });

    // Revoke all existing sessions and cached tokens
    try {
      await this.sessionRepo.deleteByUserId(userId);
      await revokeCachedTokens(userId);
    } catch (err: unknown) {
      logger.warn('Failed to revoke sessions after password reset:', {
        error: err instanceof Error ? err.message : String(err),
        userId,
      });
    }

    try {
      if (authRedisClient && authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`reset:${token}`));
      }
    } catch (err: unknown) {
      logger.warn('Failed to clean up reset token from Redis:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { success: true, message: 'Password has been successfully updated' };
  }

  async verifyEmail(token: string) {
    if (!token) throw new BadRequestError('Verification token is required');

    let userIdOrData: string | null = null;
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Verification service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      userIdOrData = await authRedisClient.get(authRedisKey(`verify:${token}`));
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      logger.error('Failed to retrieve verification token from Redis:', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableError(
        'Verification service is temporarily unavailable. Please try again.',
        'REDIS_ERROR',
        err instanceof Error ? err : undefined,
      );
    }

    if (!userIdOrData) {
      throw new UnauthorizedError('Verification token is invalid or has expired');
    }

    let userId = userIdOrData;
    try {
      const parsed = JSON.parse(userIdOrData);
      if (parsed.userId) userId = parsed.userId;
    } catch (parseErr: unknown) {
      logger.debug('Token payload is raw string ID rather than JSON', {
        token,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
    }

    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User account not found');

    await this.userRepo.update(userId, { isEmailVerified: true });

    try {
      if (authRedisClient && authRedisClient.isOpen) {
        await authRedisClient.del(authRedisKey(`verify:${token}`));
      }
    } catch (err: unknown) {
      logger.warn('Failed to clean up verification token from Redis:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { success: true, message: 'Email verified successfully. Your account is active.' };
  }

  async resendVerificationToken(email: string) {
    const user = await this.userRepo.findByEmail(email);
    if (!user) throw new NotFoundError('User with this email was not found');
    if (user.isEmailVerified) throw new ConflictError('Email is already verified');

    const verifyToken = crypto.randomBytes(32).toString('hex');
    try {
      if (!authRedisClient || !authRedisClient.isOpen) {
        throw new ServiceUnavailableError('Verification service is temporarily unavailable', 'REDIS_UNAVAILABLE');
      }
      await authRedisClient.set(authRedisKey(`verify:${verifyToken}`), user.id, { EX: 86400 });
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableError) throw err;
      logger.error('Failed to store verification token in Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new ServiceUnavailableError(
        'Unable to resend verification link. Please try again.',
        'REDIS_ERROR',
        err instanceof Error ? err : undefined,
      );
    }

    // Durable Outbox event staging (blocking guarantee)
    if (this.outboxRepo) {
      try {
        await this.outboxRepo.stageEvent(null, {
          topic: EventTopics.AUTH_EVENTS,
          partitionKey: user.id,
          eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
          aggregateType: 'USER',
          aggregateId: user.id,
          aggregateSequence: 1,
          payload: {
            id: crypto.randomUUID(),
            version: 1,
            eventType: 'USER_EMAIL_VERIFICATION_REQUESTED',
            producer: 'auth-service',
            timestamp: new Date().toISOString(),
            payload: {
              userId: user.id,
              email: user.email,
              verifyToken,
            },
          },
        });
      } catch (err: unknown) {
        logger.error('Failed to stage outbox event for email verification:', {
          error: err instanceof Error ? err.message : String(err),
          userId: user.id,
        });
        throw new ServiceUnavailableError(
          'Failed to dispatch verification email. Please try again.',
          'OUTBOX_STAGE_FAILED',
          err instanceof Error ? err : undefined,
        );
      }
    }

    publishEmailVerificationRequested({
      userId: user.id,
      email: user.email,
      verifyToken,
    }).catch((err: unknown) => {
      logger.warn('Direct Kafka event publication failed for email verification (Outbox will deliver):', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    });

    return {
      success: true,
      message: 'Verification link resent successfully',
    };
  }

  async verifyAccessToken(token: string) {
    try {
      const decoded = verifyToken(token);
      return { valid: true, payload: decoded };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedError(`Invalid access token: ${msg}`);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnauthorizedError(`Invalid refresh token: ${msg}`);
    }
  }

  async googleAuth(credential: string, ipAddress?: string, userAgent?: string) {
    if (!credential || typeof credential !== 'string') {
      throw new BadRequestError('A Google credential is required');
    }

    // 1. Verify Google ID token via Google TokenInfo API
    let payload: {
      sub: string;
      email: string;
      email_verified: boolean | string;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
      aud?: string;
    };
    try {
      const response = await axios.get<{
        sub: string;
        email: string;
        email_verified: boolean | string;
        name?: string;
        given_name?: string;
        family_name?: string;
        picture?: string;
        aud?: string;
      }>(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { timeout: 5000 }
      );
      payload = response.data;
    } catch (err: unknown) {
      if (err instanceof UnauthorizedError || err instanceof BadRequestError) {
        throw err;
      }
      if (isAxiosError(err)) {
        logger.warn('Google token verification failed with response status:', {
          status: err.response?.status,
          data: err.response?.data,
        });
        throw new UnauthorizedError('Google could not verify this account');
      }
      logger.error('Error contacting Google OAuth service:', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new UnauthorizedError('Google authentication failed');
    }

    // 2. Validate token claims
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (googleClientId && payload.aud && payload.aud !== googleClientId) {
      logger.warn('Google token audience mismatch:', { expected: googleClientId, got: payload.aud });
      throw new UnauthorizedError('Google credential audience mismatch');
    }

    const isVerified = payload.email_verified === 'true' || payload.email_verified === true;
    if (!payload.sub || !payload.email || !isVerified) {
      throw new UnauthorizedError('Google account email is not verified');
    }

    const email = payload.email.toLowerCase();

    // 3. Find or register user
    let user = await this.userRepo.findByEmail(email);
    let isNewUser = false;
    const registrationEventId = crypto.randomUUID();

    if (!user) {
      isNewUser = true;
      const nameParts = (payload.name?.trim() || '').split(' ');
      const givenName = payload.given_name?.trim() || nameParts[0];
      const familyName = payload.family_name?.trim() || nameParts.slice(1).join(' ');
      const firstName = givenName || 'Google';
      const lastName = familyName || 'User';
      const passwordHash = await this.hashPassword(crypto.randomBytes(32).toString('hex'));

      user = await this.userRepo.create({
        email,
        firstName: firstName.slice(0, 50),
        lastName: lastName.slice(0, 50),
        passwordHash,
        roles: [Role.RIDER],
        avatarUrl: payload.picture ? String(payload.picture).slice(0, 500) : undefined,
        isEmailVerified: true,
      });

      // Stage durable outbox event for user registration (blocking for dual-write consistency)
      if (this.outboxRepo) {
        try {
          await this.outboxRepo.stageEvent(null, {
            topic: EventTopics.AUTH_EVENTS,
            partitionKey: user.id,
            eventType: 'USER_REGISTERED',
            aggregateType: 'USER',
            aggregateId: user.id,
            aggregateSequence: 1,
            payload: {
              id: registrationEventId,
              version: 1,
              eventType: 'USER_REGISTERED',
              producer: 'auth-service',
              timestamp: new Date().toISOString(),
              payload: {
                userId: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                roles: user.roles,
              },
            },
          });
        } catch (err: unknown) {
          logger.error('Failed to stage outbox event for Google registration:', {
            error: err instanceof Error ? err.message : String(err),
            userId: user.id,
          });
          throw new ServiceUnavailableError(
            'Failed to complete account registration. Please try again.',
            'OUTBOX_STAGE_FAILED',
            err instanceof Error ? err : undefined,
          );
        }
      }

      const registeredUser = user;
      publishUserRegistered(
        {
          userId: registeredUser.id,
          email: registeredUser.email,
          firstName: registeredUser.firstName,
          lastName: registeredUser.lastName,
          roles: registeredUser.roles,
        },
        registrationEventId
      ).catch((err: unknown) => {
        logger.warn('Direct Kafka event publication failed for Google registration (Outbox will deliver):', {
          error: err instanceof Error ? err.message : String(err),
          userId: registeredUser.id,
        });
      });
    } else {
      // If user exists and email was not marked verified, verify it now
      if (!user.isEmailVerified) {
        user = await this.userRepo.update(user.id, { isEmailVerified: true });
      }
    }

    if (!user) {
      throw new InternalServerError('Failed to resolve authenticated Google user');
    }

    const firstName = user.firstName;
    const lastName = user.lastName;

    // 4. Session & Token generation
    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, tokenType: 'REFRESH' });

    let session;
    try {
      session = await this.sessionRepo.create({
        id: sessionId,
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress,
        userAgent: userAgent ? userAgent.slice(0, 1000) : undefined,
      });
    } catch (err: unknown) {
      logger.error('Failed to create session for Google login:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
      throw new InternalServerError('Failed to create session for Google authentication');
    }

    // Cache tokens in Redis
    try {
      await cacheTokens(user.id, session.id, accessToken, refreshToken);
      await cacheUser({
        id: user.id,
        email: user.email,
        roles: user.roles,
        firstName: user.firstName,
        lastName: user.lastName,
      });
    } catch (err: unknown) {
      logger.warn('Failed to cache Google user tokens in Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    // Audit log
    try {
      await this.auditRepo.record({
        userId: user.id,
        action: isNewUser ? 'USER_REGISTERED_GOOGLE' : 'USER_LOGIN_GOOGLE',
        ipAddress,
      });
    } catch (err: unknown) {
      logger.warn('Failed to record audit log for Google auth:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    const userPayload = {
      id: user.id,
      email: user.email,
      firstName,
      lastName,
      roles: user.roles,
      isEmailVerified: user.isEmailVerified,
      avatarUrl: user.avatarUrl,
    };

    return {
      user: userPayload,
      accessToken,
      refreshToken,
      sessionId,
    };
  }
}
