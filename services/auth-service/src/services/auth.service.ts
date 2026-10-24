import { parseClientInfo } from '../utils/user-agent.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios, { isAxiosError } from 'axios';
import { UserRepository } from '../repositories/user.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../crypto/keys.js';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError, ForbiddenError, createLogger, ServiceUnavailableError, InternalServerError } from '@urbanfleet/common';
import { Role } from '../db/client.js';
import { cacheTokens, revokeCachedTokens, cacheUser, revokeOtherSessions, getCachedRefreshToken } from '../redis/token-cache.js';
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
  private outboxRepo?: OutboxRepository;

  constructor(
    userRepo: UserRepository,
    sessionRepo: SessionRepository,    outboxRepo?: OutboxRepository
  ) {
    this.userRepo = userRepo;
    this.sessionRepo = sessionRepo;
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
    roles?: Array<Role | 'RIDER' | 'DRIVER'>;
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
    };
  }

  async login(input: { email: string; password: string }) {
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
      await authRedisClient.set(authRedisKey(`otp:login:${user.id}`), otp, { EX: 300 });
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
      email: user.email,
      message: 'Verification code sent to your email',
    };
  }

  async verifyLoginOtp(input: {
    email: string;
    otp: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const user = await this.userRepo.findByEmail(input.email.toLowerCase());

    if (!user) {
      throw new UnauthorizedError('Invalid or expired verification code');
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
        await authRedisClient.del(authRedisKey(`otp:login:${user.id}`));
      }
    } catch (err: unknown) {
      logger.warn('Failed to delete consumed OTP from Redis:', {
        error: err instanceof Error ? err.message : String(err),
        userId: user.id,
      });
    }

    const firstName = user.firstName ;
    const lastName = user.lastName ;

    const sessionId = crypto.randomUUID();
    const clientInfo = parseClientInfo(input.userAgent, input.ipAddress);
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({ userId: user.id, sessionId, sessionVersion: 1, tokenType: 'REFRESH' });

    let session;
    try {
      session = await this.sessionRepo.create({
        id: sessionId,
        userId: user.id,
        version: 1,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent ? input.userAgent.slice(0, 1000) : undefined,
        deviceType: clientInfo.deviceType,
        browser: clientInfo.browser,
        os: clientInfo.os,
        lastActiveAt: new Date(),
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

  async logout(refreshToken?: string, sessionId?: string, userId?: string) {
    if (sessionId && userId) {
      await Promise.all([
        Promise.resolve(this.sessionRepo.delete(sessionId)).catch(() => {}),
        revokeCachedTokens(userId, sessionId),
      ]);
      return { success: true };
    }

    if (!refreshToken) return { success: true };
    try {
      const decoded = verifyToken(refreshToken);
      if (decoded?.sessionId && decoded?.userId) {
        await Promise.all([
          this.sessionRepo.delete(decoded.sessionId).catch(() => {}),
          revokeCachedTokens(decoded.userId, decoded.sessionId),
        ]);
      }
    } catch (err: unknown) {
      logger.error('Error during logout:', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: true };
  }

  async refreshAccessToken(refreshToken: string) {
    let decoded;
    try {
      decoded = verifyToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Refresh token expired or invalid');
    }

    if (!decoded || decoded.tokenType !== 'REFRESH' || !decoded.userId || !decoded.sessionId) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const { userId, sessionId } = decoded;
    const tokenSessionVersion = decoded.sessionVersion ?? 1;

    // Check Redis for active refresh token
    const cachedToken = await getCachedRefreshToken(userId, sessionId);
    const session = await this.sessionRepo.findById(sessionId);

    // Replay / Reuse detection:
    if (session && tokenSessionVersion < session.version) {
      // Security Alert: An old rotated token was replayed!
      await Promise.all([
        Promise.resolve(this.sessionRepo.delete(sessionId)).catch(() => {}),
        revokeCachedTokens(userId, sessionId),
      ]);
      logger.warn('Refresh token reuse detected! Revoked session.', { userId, sessionId });
      throw new UnauthorizedError('Security alert: Token reuse detected. Session terminated.');
    }

    if (!session || new Date() > session.expiresAt) {
      await revokeCachedTokens(userId, sessionId).catch(() => {});
      throw new UnauthorizedError('Session expired or invalid');
    }

    if (tokenSessionVersion !== session.version) {
      await Promise.all([
        Promise.resolve(this.sessionRepo.delete(sessionId)).catch(() => {}),
        revokeCachedTokens(userId, sessionId),
      ]);
      throw new UnauthorizedError('Session version mismatch. Please log in again.');
    }

    if (cachedToken && cachedToken !== refreshToken) {
      throw new UnauthorizedError('Refresh token has already been rotated or invalidated');
    }

    const user = await this.userRepo.findById(session.userId);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Legitimate rotation: increment session version
    const nextVersion = session.version + 1;
    await this.sessionRepo.updateVersion(session.id, nextVersion);

    const firstName = user.firstName;
    const lastName = user.lastName;
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId: session.id,
      tokenType: 'ACCESS',
    });

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      sessionId: session.id,
      sessionVersion: nextVersion,
      tokenType: 'REFRESH',
    });

    // Cache updated tokens in Redis
    try {
      await cacheTokens(user.id, session.id, accessToken, newRefreshToken);
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

  async listActiveSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.sessionRepo.findByUserId(userId);
    const now = new Date();
    const active = sessions
      .filter((s) => s.expiresAt > now)
      .map((s) => ({
        id: s.id,
        browser: s.browser || 'Unknown Browser',
        os: s.os || 'Unknown OS',
        deviceType: s.deviceType || 'Desktop',
        ipAddress: s.ipAddress || 'Unknown IP',
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
        isCurrent: Boolean(currentSessionId && s.id === currentSessionId),
      }));
    return {
      currentSessionId: currentSessionId || null,
      sessions: active,
    };
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundError('Session not found');
    }
    await Promise.all([
      Promise.resolve(this.sessionRepo.delete(sessionId)).catch(() => {}),
      revokeCachedTokens(userId, sessionId),
    ]);
    return { success: true, message: 'Session revoked successfully' };
  }

  async revokeAllOtherSessions(userId: string, currentSessionId: string) {
    await Promise.all([
      Promise.resolve(this.sessionRepo.deleteByUserId(userId, currentSessionId)).catch(() => {}),
      revokeOtherSessions(userId, currentSessionId),
    ]);
    return { success: true, message: 'All other sessions revoked successfully' };
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

  async googleAuth(credential: string, ipAddress: string, userAgent: string) {
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
    const clientInfo = parseClientInfo(userAgent, ipAddress);
    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      firstName,
      lastName,
      sessionId,
      tokenType: 'ACCESS',
    });
    const refreshToken = signRefreshToken({
      userId: user.id,
      sessionId,
      sessionVersion: 1,
      tokenType: 'REFRESH',
    });

    let session;
    try {
      session = await this.sessionRepo.create({
        id: sessionId,
        userId: user.id,
        version: 1,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress,
        userAgent: userAgent ? userAgent.slice(0, 1000) : undefined,
        deviceType: clientInfo.deviceType,
        browser: clientInfo.browser,
        os: clientInfo.os,
        lastActiveAt: new Date(),
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
